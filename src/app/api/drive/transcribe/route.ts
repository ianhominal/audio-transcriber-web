import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getApiUser } from "@/lib/supabase/api";
import { downloadFileBinary, DriveApiError } from "@/lib/drive/api";
import { getUserDriveAccessToken, DriveNotConnectedError } from "@/lib/drive/connection";
import { isMissingColumnError } from "@/lib/supabase/schema-compat";
import { resolveGroqModel } from "@/lib/transcribe/model";
import { DAILY_LIMIT, isOverDailyLimit } from "@/lib/rateLimit";
import { GROQ_MAX_AUDIO_BYTES } from "@/lib/drive/audio-import";

export const runtime = "nodejs";
export const maxDuration = 60;

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

/**
 * Audios importados de Drive que todavía no se transcribieron: los que tienen
 * `drive_audio_file_id` y siguen sin texto. Lo usa el banner del dashboard para saber si hay algo
 * pendiente sin tener que meter esta columna nueva en la query (y en la cascada de compat) de
 * `/app`.
 *
 * Degrada a lista vacía si la columna todavía no existe (ventana de rollout de la migración): un
 * banner que no aparece es mucho mejor que un dashboard roto.
 */
export async function GET(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("transcriptions")
    .select("id, title, audio_name, project_id")
    .not("drive_audio_file_id", "is", null)
    .or("text.is.null,text.eq.")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    if (!isMissingColumnError(error)) {
      console.error("[drive/transcribe] error listando pendientes:", error.message);
    }
    return NextResponse.json({ pending: [] });
  }

  return NextResponse.json({ pending: data ?? [] });
}

/**
 * Transcribe UN audio importado de una carpeta de Drive (ver `/api/drive/folders/connect`, bloque
 * 4b): baja el binario del archivo, lo manda a Groq Whisper y guarda el texto en la transcripción
 * pendiente que ya existe.
 *
 * De a UNO por request a propósito. Una carpeta con 14 grabaciones no entra en el `maxDuration = 60`
 * de Vercel ni de casualidad, así que el cliente los procesa en SERIE — exactamente el mismo patrón
 * que la cola de `/app/transcribe` con los archivos subidos a mano. Nada de jobs en background:
 * el progreso se ve, se puede cortar, y cada audio que sale queda guardado aunque el siguiente falle.
 *
 * El audio NO se copia a Supabase Storage: ya vive en el Drive del usuario, que es su lugar. Acá
 * solo se lo lee de paso para transcribirlo.
 */
export async function POST(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "El servidor no tiene configurada la clave de transcripción." }, { status: 500 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const tokenKey = process.env.DRIVE_TOKEN_KEY;
  if (!clientId || !clientSecret || !tokenKey) {
    return NextResponse.json({ error: "Falta configuración de Drive en el servidor." }, { status: 500 });
  }

  let body: { id?: unknown; model?: unknown; language?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Falta el id de la nota." }, { status: 400 });
  }
  const model = resolveGroqModel(body.model);
  const language = typeof body.language === "string" ? body.language : "";

  // 1) La transcripción pendiente. RLS ya scopea por dueño (una fila ajena da `data: null`), mismo
  //    criterio que `/api/summarize`.
  const { data: row, error: rowError } = await supabase
    .from("transcriptions")
    .select("id, text, audio_name, drive_audio_file_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (rowError) {
    if (isMissingColumnError(rowError)) {
      return NextResponse.json(
        { error: "Todavía se está aplicando una actualización del servidor. Probá de nuevo en unos minutos." },
        { status: 503 }
      );
    }
    console.error("[drive/transcribe] error leyendo la nota:", rowError.message);
    return NextResponse.json({ error: "No se pudo leer la nota." }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "No se encontró la nota." }, { status: 404 });
  }

  const driveAudioFileId = (row as { drive_audio_file_id?: string | null }).drive_audio_file_id;
  if (!driveAudioFileId) {
    return NextResponse.json({ error: "Esta nota no tiene un audio de Drive asociado." }, { status: 400 });
  }
  if (((row.text as string | null) ?? "").trim().length > 0) {
    // Ya transcripta: no se re-transcribe sola. Evita que un doble click, un reintento del cliente o
    // un "transcribir todo" repetido quemen cuota de Groq re-haciendo trabajo ya hecho.
    return NextResponse.json({ ok: true, alreadyTranscribed: true, id: row.id });
  }

  // 2) Límite diario de transcripciones, el MISMO que el resto de la app: importar desde Drive no
  //    puede ser una puerta de atrás para saltearse la cuota.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase
    .from("transcriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);

  if (countError) {
    console.error("[drive/transcribe] error contando el límite diario:", countError.message);
    return NextResponse.json({ error: "No pudimos verificar tu límite diario. Probá de nuevo." }, { status: 503 });
  }
  if (isOverDailyLimit(count ?? 0, DAILY_LIMIT)) {
    return NextResponse.json(
      { error: `Llegaste al límite de ${DAILY_LIMIT} transcripciones por día. Probá mañana.` },
      { status: 429 }
    );
  }

  try {
    const accessToken = await getUserDriveAccessToken(supabase, user.id, { clientId, clientSecret, tokenKey });

    // 3) Bajar el audio de Drive y frenar por tamaño ANTES de mandarlo a Groq (que lo rechazaría).
    const { blob, name, sizeBytes } = await downloadFileBinary(accessToken, driveAudioFileId);
    if (sizeBytes > GROQ_MAX_AUDIO_BYTES) {
      return NextResponse.json(
        {
          error: `"${name}" pesa más de 25 MB y no se puede transcribir en la nube. Podés transcribirlo desde la app de escritorio.`,
          code: "too-large",
        },
        { status: 400 }
      );
    }

    // 4) Groq Whisper. Mismo endpoint y forma que `/api/transcribe` — el archivo va como FormData.
    const groqForm = new FormData();
    groqForm.append("file", blob, row.audio_name || name);
    groqForm.append("model", model);
    groqForm.append("response_format", "json");
    if (language && language !== "auto") groqForm.append("language", language);

    let resp: Response;
    try {
      resp = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: groqForm,
      });
    } catch {
      return NextResponse.json(
        { error: "No se pudo conectar con el servicio de transcripción. Probá de nuevo en un momento." },
        { status: 502 }
      );
    }

    const raw = await resp.text();
    let parsed: { text?: string; error?: { message?: string } } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* respuesta no-JSON */
    }

    if (!resp.ok) {
      console.error("[drive/transcribe] Groq falló", { userId: user.id, status: resp.status });
      return NextResponse.json(
        { error: parsed?.error?.message || "No se pudo transcribir el audio." },
        { status: 502 }
      );
    }

    const text = (parsed.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "El audio no devolvió texto (¿está en silencio?)." }, { status: 422 });
    }

    // 5) Guardar. Al quedar la transcripción CON texto y SIN entrada en `drive_file_map`, el motor de
    //    sync la va a exportar como un .md nuevo al lado del audio (`push_create`) — el audio, que
    //    nunca entró al mapa, sigue intocable.
    const { error: updateError } = await supabase
      .from("transcriptions")
      .update({ text })
      .eq("id", row.id);

    if (updateError) {
      console.error("[drive/transcribe] error guardando el texto:", updateError.message);
      return NextResponse.json({ error: "Se transcribió pero no se pudo guardar. Probá de nuevo." }, { status: 500 });
    }

    revalidatePath("/app");
    return NextResponse.json({ ok: true, id: row.id, characters: text.length });
  } catch (err) {
    if (err instanceof DriveNotConnectedError) {
      return NextResponse.json({ error: err.message, code: "not-connected" }, { status: 400 });
    }
    if (err instanceof DriveApiError) {
      const needsReauth = err.code === "invalid_grant";
      return NextResponse.json(
        { error: err.message, code: needsReauth ? "needs-reauth" : (err.code ?? "drive-error") },
        { status: err.status ?? 502 }
      );
    }
    console.error("[drive/transcribe] error inesperado:", err);
    return NextResponse.json({ error: "No se pudo transcribir el audio." }, { status: 500 });
  }
}
