import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { randomUUID } from "crypto";
import { getApiUser } from "@/lib/supabase/api";
import {
  AUDIO_BUCKET,
  audioExtension,
  buildAudioObjectPath,
  uploadWithRetry,
  UPLOAD_MAX_ATTEMPTS,
} from "@/lib/storage";
import { DAILY_LIMIT, isOverDailyLimit } from "@/lib/rateLimit";
import { resolveGroqModel } from "@/lib/transcribe/model";
import { dedupeSatisfiesRequest } from "@/lib/transcribe/dedupe";
import { resolveTranscribeMode, resolveTranslationLanguage, translationLanguageLabel } from "@/lib/translate/languages";
import { translateText } from "@/lib/translate/groq";
import { listVocabularyTerms } from "@/lib/vocabulary/store";
import { correctTextWithVocabulary } from "@/lib/vocabulary/groq";
import { generateTitleAndTags } from "@/lib/titleTags/groq";
import { canGenerateTitleTags, isPlaceholderTitle } from "@/lib/titleTags/validate";
import { isAiTitleTagsDailyLimitError } from "@/lib/aiUsage";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase/schema-compat";

export const runtime = "nodejs";
export const maxDuration = 60;

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

/**
 * Transcribe un audio con Groq y guarda el resultado. Requiere sesión.
 * La clave de Groq vive SOLO en el servidor (GROQ_API_KEY).
 */
export async function POST(req: NextRequest) {
  // 1) Sesión obligatoria (cookies web o Bearer del cliente desktop).
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "El servicio de transcripción no está disponible en este momento." },
      { status: 500 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "No se pudo leer el archivo." }, { status: 400 });
  }

  const file = form.get("file");
  const language = (form.get("language") as string) || "es";
  // El modelo lo elige el cliente, pero SIEMPRE se valida contra una allowlist estricta
  // antes de mandarlo a Groq (ver src/lib/transcribe/model.ts) — nunca se reenvía tal cual.
  const model = resolveGroqModel(form.get("model"));
  // Modo "Transcribir" vs "Transcribir y traducir" (Fase F4, ver ROADMAP.md item 6) + idioma
  // destino — ambos validados contra allowlists estrictas (ver src/lib/translate/languages.ts),
  // mismo criterio que `model`/`language` acá arriba.
  const mode = resolveTranscribeMode(form.get("mode"));
  const targetLanguage = resolveTranslationLanguage(form.get("targetLanguage"));

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No se recibió ningún audio." }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "El audio supera los 25 MB." }, { status: 413 });
  }

  const audioName = file.name || "audio";

  // El título opcional que manda el cliente (ej. el que la usuaria editó/dejó en la cola de
  // TranscribeWorkspace) se lee ACÁ arriba — antes vivía junto al insert (paso 4), pero el paso 2.7
  // (auto-título) más abajo necesita decidir si este título es "mecánico" (nombre de archivo/
  // grabación por defecto, ver `isPlaceholderTitle`) ANTES de armar la fila a insertar. Columna
  // `title` es NOT NULL DEFAULT '' (ver migración transcription_title): si no viene título,
  // guardamos "" (no null) — la UI ya usa `audio_name` como fallback visual cuando `title` está
  // vacío (ver placeholder en TranscriptionDetail).
  const titleRaw = (form.get("title") as string) || "";
  const title = titleRaw.trim().slice(0, 120);

  // 1.4) Límite diario de transcripciones por usuario.
  //      Se cuentan también las transcripciones soft-deleted: el usuario ya consumió cuota
  //      real de Groq al crearlas, sin importar si luego las movió a la papelera.
  //
  //      Fail-CLOSED (corrección del review adversarial 2026-07-10, hallazgo MEDIUM #4): antes se
  //      destructuraba solo `{ count }` sin mirar `error` — si la query fallaba (timeout, RLS,
  //      conexión), `count` quedaba `null`, `isOverDailyLimit(0, DAILY_LIMIT)` daba `false` y el
  //      request PASABA igual, como si el usuario no hubiera consumido nada de cuota ese día. Ante
  //      un error real de la query no sabemos cuánto lleva consumido el usuario, así que no se puede
  //      asumir "0" — se corta con 503 en vez de dejar pasar sin verificar (mismo criterio de "ante
  //      la duda, no arriesgar" que ya usa el fetch de `/api/summarize`).
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount, error: dailyCountErr } = await supabase
    .from("transcriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", oneDayAgo);

  if (dailyCountErr) {
    console.error("[transcribe] daily limit count failed", {
      userId: user.id,
      error: dailyCountErr.message,
    });
    Sentry.captureException(new Error(dailyCountErr.message || "Error al verificar el límite diario."), {
      extra: { userId: user.id, stage: "daily-limit-count" },
    });
    return NextResponse.json(
      { error: "No pudimos verificar tu límite diario. Probá de nuevo." },
      { status: 503 }
    );
  }

  if (isOverDailyLimit(dailyCount ?? 0, DAILY_LIMIT)) {
    return NextResponse.json(
      { error: "Llegaste al límite diario de transcripciones. Probá mañana o escribinos." },
      { status: 429 }
    );
  }

  // 1.5) Dedupe: si ya existe una transcripción con el mismo nombre y tamaño para este
  //      usuario, no volvemos a llamar a Groq ni a duplicar. Devolvemos la existente.
  //      Esto también neutraliza el doble-submit (dos requests casi simultáneas).
  //
  //      Fase F4: el dedupe TIENE EN CUENTA el modo. Si el usuario pide "Transcribir y traducir" a
  //      un idioma que la copia existente NO tiene (`translated_to` distinto del pedido), NO
  //      cortamos acá — dejamos que el request siga y produzca la versión traducida (un artefacto
  //      genuinamente distinto, no un duplicado). Sin esto, pedir traducir un archivo ya transcrito
  //      devolvía la versión vieja SIN traducir informando éxito total (ni warning ni badge): el
  //      feature que el usuario pidió simplemente no ocurría, en silencio.
  //
  //      `translated_to` puede no existir todavía en el esquema del preview (migración F4 sin
  //      aplicar) — ante un 42703 reintentamos sin esa columna y asumimos "no traducida" (`null`),
  //      mismo patrón de compat que el insert/select de más abajo.
  // `title` se suma al SELECT (y al `reduced` de compat de abajo) sin ninguna cascada extra: a
  // diferencia de `translated_to`/`tags`, la columna `title` viene de la migración más vieja de las
  // tres (`20260706180000_transcription_title.sql`, previa incluso a F4) — si `translated_to` llega
  // a faltar y dispara el fallback de compat, `title` YA existe igual, así que es seguro pedirla en
  // los dos SELECT sin un nuevo nivel de `isMissingColumnError`. Hace falta para que la cola de
  // `TranscribeWorkspace` pueda mostrar el título auto-generado también en un duplicado (ítem
  // `status: "duplicate"`), no solo en una transcripción nueva.
  let existing: { id: string; text: string | null; title: string | null; translated_to: string | null } | null =
    null;
  {
    const withTranslated = await supabase
      .from("transcriptions")
      .select("id, text, title, translated_to")
      .eq("user_id", user.id)
      .eq("audio_name", audioName)
      .eq("audio_size", file.size)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (withTranslated.error && isMissingColumnError(withTranslated.error)) {
      const reduced = await supabase
        .from("transcriptions")
        .select("id, text, title")
        .eq("user_id", user.id)
        .eq("audio_name", audioName)
        .eq("audio_size", file.size)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      existing = reduced.data ? { ...reduced.data, translated_to: null } : null;
    } else {
      existing = withTranslated.data ?? null;
    }
  }

  if (existing) {
    // La copia existente satisface el pedido si NO se pidió traducir Y la fila no es en sí misma
    // una traducción, o si se pidió traducir y ya está traducida al mismo idioma destino — mode-
    // aware en ambas direcciones (ver `dedupeSatisfiesRequest`, bugfix del review adversarial
    // 2026-07-10, hallazgo MEDIUM #1: antes un request "transcribir" sobre una fila YA traducida
    // devolvía el texto traducido como si fuera la transcripción original, sin avisar).
    const alreadySatisfiesRequest = dedupeSatisfiesRequest(mode, existing.translated_to, targetLanguage);
    if (alreadySatisfiesRequest) {
      // `title` viaja en la respuesta para que la cola (`TranscribeWorkspace`) pueda reflejar el
      // título YA guardado (auto-generado o no) en vez de quedarse con el nombre de archivo del
      // ítem — bugfix UX 2026-07-11, ver `src/lib/format.ts` (`resolveQueueTitle`).
      return NextResponse.json({
        text: existing.text ?? "",
        duplicate: true,
        id: existing.id,
        title: existing.title ?? "",
      });
    }
  }

  // 2) Transcribir con Groq.
  const groqForm = new FormData();
  groqForm.append("file", file, file.name || "audio");
  groqForm.append("model", model);
  groqForm.append("response_format", "json");
  if (language && language !== "auto") groqForm.append("language", language);

  let groqResp: Response;
  try {
    groqResp = await fetch(GROQ_ENDPOINT, {
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

  // Cuota diaria agotada → mensaje amigable ("pausado para todos" hoy).
  if (groqResp.status === 429) {
    return NextResponse.json(
      { error: "El servicio está saturado por hoy (se alcanzó el límite diario). Probá más tarde." },
      { status: 429 }
    );
  }

  const raw = await groqResp.text();
  let data: { text?: string; error?: { message?: string } } = {};
  try {
    data = JSON.parse(raw);
  } catch {
    /* respuesta no-JSON */
  }

  if (!groqResp.ok) {
    return NextResponse.json(
      { error: data?.error?.message || "No se pudo completar la transcripción. Probá de nuevo." },
      { status: groqResp.status }
    );
  }

  const text = (data.text ?? "").trim();

  // 2.5) Si se pidió "Transcribir y traducir", traducir el texto con un LLM (Groq
  //      `llama-3.1-8b-instant`, ver src/lib/translate/groq.ts). El modo "translate" nativo de
  //      Whisper SOLO traduce a inglés (research previo, ver ROADMAP.md) — por eso se traduce el
  //      TEXTO ya transcrito, no el audio, lo que permite traducir a cualquier idioma de la
  //      allowlist. Best-effort: si la traducción falla, NO se pierde el trabajo — se guarda la
  //      transcripción original igual, con un aviso para el cliente (ver `translationWarning`).
  let finalText = text;
  let translatedTo: string | null = null;
  let originalText: string | null = null;
  let translationWarning: string | undefined;

  if (mode === "translate") {
    const targetLabel = translationLanguageLabel(targetLanguage);
    // `translateText` está documentada para NUNCA lanzar (maneja red/parseo internamente), pero
    // igual la envolvemos en try/catch: todos los pasos best-effort de este handler (subida de
    // audio, insert) están protegidos así justamente para que una falla acá jamás tire abajo el
    // request y pierda la transcripción de Whisper ya pagada. Defensa en profundidad ante un futuro
    // cambio en `groq.ts` que introduzca un throw — un throw no atrapado 500-earía todo el handler
    // antes de guardar nada.
    let translationError: string | null = null;
    try {
      const translation = await translateText(text, targetLabel, apiKey);
      if (translation.ok) {
        finalText = translation.text;
        translatedTo = targetLanguage;
        originalText = text;
      } else {
        translationError = translation.error;
      }
    } catch (err) {
      translationError = err instanceof Error ? err.message : "Error inesperado al traducir.";
    }

    if (translationError) {
      translationWarning = `No se pudo traducir, pero se guardó la transcripción original: ${translationError}`;
      console.error("[transcribe] translation failed", {
        userId: user.id,
        targetLanguage,
        error: translationError,
      });
      Sentry.captureException(new Error(translationError), {
        extra: { userId: user.id, stage: "translate", targetLanguage },
      });
    }
  }

  // 2.6) Corrección con el vocabulario custom del usuario — feature diferencial #1 (nombres de
  //      invitados recurrentes, marcas, jerga que el usuario siempre corrige a mano, ver
  //      .claude/resources/BUSINESS.md). Corre sobre `finalText` (el texto FINAL: traducido si se
  //      pidió traducción, o el transcripto tal cual si no), después de la traducción — mismo orden
  //      que pidió el producto: transcribir → traducir → corregir.
  //
  //      Best-effort, mismo criterio que la traducción: si falla, el texto queda como estaba, nunca
  //      se pierde ni se bloquea el request. Ahorro explícito: si el usuario no cargó NINGÚN término,
  //      `listVocabularyTerms` devuelve `[]` y `correctTextWithVocabulary` ni siquiera intenta
  //      contactar a Groq (ver su implementación) — cero costo para el usuario común que no usa esta
  //      feature. `useVocabulary=false` (toggle "Corregir con tu vocabulario" en TranscribeWorkspace)
  //      la desactiva por completo para esta tanda puntual sin gastar ni siquiera la lectura de la
  //      tabla.
  let vocabularyCorrected: boolean | null = null;
  const useVocabulary = (form.get("useVocabulary") as string) !== "false";
  if (useVocabulary) {
    const terms = await listVocabularyTerms(supabase, user.id);
    if (terms.length > 0) {
      try {
        const correction = await correctTextWithVocabulary(
          finalText,
          terms.map((t) => t.term),
          apiKey
        );
        if (correction.ok) {
          finalText = correction.text;
          vocabularyCorrected = correction.corrected;
        } else {
          console.error("[transcribe] vocabulary correction failed", {
            userId: user.id,
            error: correction.error,
          });
          Sentry.captureException(new Error(correction.error), {
            extra: { userId: user.id, stage: "vocabulary-correction" },
          });
        }
      } catch (err) {
        // Defensa en profundidad — `correctTextWithVocabulary` está documentada para nunca lanzar,
        // mismo criterio que el try/catch extra alrededor de `translateText` más arriba.
        console.error("[transcribe] vocabulary correction threw", err);
        Sentry.captureException(err, { extra: { userId: user.id, stage: "vocabulary-correction" } });
      }
    }
  }

  // 2.7) Auto-título + auto-tags Y 3) Subir el audio a Storage — EN PARALELO (no secuencial, fix del
  //      review adversarial de esta misma tanda). Los dos pasos son independientes entre sí (título/
  //      tags solo necesita `finalText`/`translatedTo`/`language`; la subida solo necesita `file`/
  //      `audioName`) y cada uno best-effort por separado — ninguno puede rechazar la promesa que
  //      Promise.all espera (cada uno tiene su propio try/catch interno que nunca re-lanza, ver
  //      abajo). Encadenarlos secuencialmente sumaba hasta 8s más (el timeout de título/tags) DESPUÉS
  //      de transcribir+traducir+corregir vocabulario y ANTES de guardar — acercando el request al
  //      techo de `maxDuration = 60` más de lo necesario, justo el riesgo que la regla de oro de 2.7
  //      (nunca demorar la transcripción) existe para evitar.
  let autoTags: string[] = [];
  let autoTitle: string | null = null;
  let audioPath: string | null = null;

  await Promise.all([
    // 2.7) Auto-título + auto-tags (tanda 3 de quick wins, ver ROADMAP.md): UNA sola llamada al LLM
    //      barato (mismo modelo que resumen/traducción/vocabulario) genera, a partir de `finalText`
    //      (el texto YA traducido/corregido — el título/tags deben describir lo que la usuaria
    //      realmente va a leer), un título corto + 3-5 tags de tema. Mata el problema de notas
    //      indistinguibles ("Grabación 47").
    //
    //      REGLA DE ORO (best-effort ESTRICTO, más estricto incluso que traducción/vocabulario): esto
    //      corre DESPUÉS de que Whisper ya transcribió (el trabajo caro/pagado) — si esta llamada
    //      falla, tarda de más, o se pasa del cap, la transcripción se guarda IGUAL, sin título/tags.
    //      Dos capas independientes garantizan esto: `generateTitleAndTags` está documentada para
    //      nunca lanzar (siempre `{ ok: false }` ante cualquier falla, ver `src/lib/titleTags/groq.ts`)
    //      Y todo este paso vive en su propio try/catch, igual que traducción/vocabulario arriba —
    //      ningún error de este bloque puede propagarse y tirar abajo el resto del request.
    //
    //      Cap de costo: mismo patrón reserve-on-attempt + trigger atómico que `/api/summarize`
    //      (`kind: "title_tags"` en `ai_usage_log`, ver `20260711160000_transcription_tags.sql`) —
    //      pero a diferencia de `/api/summarize` (endpoint DEDICADO a la acción cacheada, fail-CLOSED
    //      con 503/429 ante cualquier problema del cap), acá CUALQUIER resultado del insert que no sea
    //      éxito significa "no generamos esta vez" y se sigue de largo: el propósito de este request
    //      es la transcripción, título/tags es un extra, nunca al revés.
    (async () => {
      if (!canGenerateTitleTags(finalText)) return;
      try {
        const { error: usageLogErr } = await supabase
          .from("ai_usage_log")
          .insert({ user_id: user.id, kind: "title_tags", forced: false });

        if (!usageLogErr) {
          // Idioma del título/tags: mismo criterio que el resumen (`/api/summarize`) — el idioma del
          // texto FINAL (traducido si aplica, o el mismo idioma del texto si es "auto").
          const languageLabel = translatedTo
            ? translationLanguageLabel(translatedTo)
            : language && language !== "auto"
              ? translationLanguageLabel(language)
              : null;

          const result = await generateTitleAndTags(finalText, languageLabel, apiKey);
          if (result.ok) {
            autoTags = result.result.tags;
            // El auto-título SOLO pisa un título mecánico (nombre de archivo/grabación por defecto)
            // — NUNCA uno que la usuaria haya escrito a mano (ver `isPlaceholderTitle`).
            if (isPlaceholderTitle(title, audioName)) {
              autoTitle = result.result.title;
            }
          } else {
            console.error("[transcribe] title/tags generation failed", { userId: user.id, error: result.error });
            Sentry.captureException(new Error(result.error), {
              extra: { userId: user.id, stage: "title-tags" },
            });
          }
        } else if (!isAiTitleTagsDailyLimitError(usageLogErr) && !isMissingTableError(usageLogErr)) {
          // Cualquier error que NO sea el cap funcionando como corresponde (límite alcanzado) ni la
          // ventana de rollout de la migración (tabla/trigger sin aplicar todavía) es inesperado —
          // se reporta, pero SIGUE sin título/tags, nunca bloquea.
          console.error("[transcribe] title/tags usage log insert failed", {
            userId: user.id,
            error: usageLogErr.message,
          });
          Sentry.captureException(usageLogErr, {
            extra: { userId: user.id, stage: "title-tags-usage-log-insert" },
          });
        }
      } catch (err) {
        // Defensa en profundidad — `generateTitleAndTags` está documentada para nunca lanzar, mismo
        // criterio que el try/catch extra alrededor de `translateText`/`correctTextWithVocabulary`.
        console.error("[transcribe] title/tags step threw", err);
        Sentry.captureException(err, { extra: { userId: user.id, stage: "title-tags" } });
      }
    })(),

    // 3) Subir el audio a Storage (bucket privado, carpeta del usuario). Best-effort:
    //    si falla la subida, igual guardamos el texto (sin audio).
    (async () => {
      try {
        const ext = audioExtension(audioName);
        const path = buildAudioObjectPath(user.id, randomUUID(), ext);
        // Reintenta ante fallas transitorias (red, timeouts) con backoff: 3 intentos totales.
        // Mismo path en cada intento — es seguro porque `upsert: false` y el intento previo
        // falló, así que el objeto nunca llegó a crearse.
        const { error: upErr, attempts } = await uploadWithRetry(() =>
          supabase.storage.from(AUDIO_BUCKET).upload(path, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false,
          })
        );
        if (!upErr) {
          audioPath = path;
        } else {
          // Best-effort: no bloqueamos la respuesta, pero esto NO puede desaparecer en
          // silencio — sin este log era imposible saber por qué un audio se perdía
          // (bucket inexistente, RLS, etc.) sin entrar al dashboard de Supabase.
          console.error("[transcribe] audio upload failed", {
            path,
            userId: user.id,
            error: upErr.message,
            name: upErr.name,
            attempts,
          });
          Sentry.captureException(upErr, {
            extra: { path, userId: user.id, stage: "audio-upload", attempts },
          });
        }
      } catch (err) {
        // Llegar acá significa que `uploadWithRetry` agotó los UPLOAD_MAX_ATTEMPTS intentos y el
        // último también lanzó una excepción (no un `error` devuelto por el SDK).
        console.error("[transcribe] audio upload threw", err, { attempts: UPLOAD_MAX_ATTEMPTS });
        Sentry.captureException(err, {
          extra: { userId: user.id, stage: "audio-upload", attempts: UPLOAD_MAX_ATTEMPTS },
        });
      }
    })(),
  ]);

  // 4) Guardar la transcripción. Acepta un proyecto destino opcional (el título ya se leyó más
  //    arriba, ver comentario junto a `audioName` — lo necesitaba el paso 2.7 de auto-título).
  //    `finalTitle` es el generado automáticamente (si el paso 2.7 corrió Y el título original era
  //    mecánico) o, si no, el título tal cual llegó del cliente — nunca pisa un título que la
  //    usuaria haya escrito a mano.
  const projectId = (form.get("projectId") as string) || null;
  const finalTitle = autoTitle ?? title;
  let savedId: string | null = null;
  // true solo si la fila terminó guardada CON la columna `tags` (el primer intento del cascade de
  // abajo, el único que la incluye, salió sin error) — bugfix del review adversarial de este mismo
  // cambio (2026-07-11): la respuesta de más abajo NO puede devolver `autoTags` a ciegas, porque si
  // ese primer intento cae en la cascada de compat (columna `tags` sin migrar en este entorno), la
  // fila real queda SIN tags aunque `autoTags` siga poblado en memoria — mismo criterio que
  // `audioStored` ya usa (chequear el resultado real de la operación, no asumir éxito).
  let tagsSaved = false;
  try {
    const baseRow = {
      user_id: user.id,
      project_id: projectId,
      title: finalTitle,
      audio_name: audioName,
      audio_size: file.size,
      audio_url: audioPath, // path del objeto; la URL firmada se genera al leer.
      text: finalText,
      language,
      model,
    };
    // `translated_to`/`original_text` (Fase F4, ver supabase/migrations/20260709210000_translation.sql),
    // `vocabulary_corrected` (feature de vocabulario custom, ver
    // supabase/migrations/20260710120000_user_vocabulary.sql) y `tags` (tanda 3 de quick wins, ver
    // supabase/migrations/20260711160000_transcription_tags.sql) se aplican automático recién al
    // mergear a `main` (mismo criterio que `projects.color` en F2) — en el preview de esta branch
    // pueden no existir todavía, e INDEPENDIENTEMENTE unas de otras (F4 puede estar aplicada y
    // vocabulario no, es el caso más común en el día a día). Se intenta con TODAS las columnas
    // nuevas primero y, ante un 42703 (columna inexistente), se cae en cascada, MÁS NUEVA primero:
    // sin `tags`, después sin `vocabulary_corrected` tampoco, después sin ninguna de las cuatro. En
    // cualquier nivel, el texto final (traducido y/o corregido) SIGUE llegando al usuario en la
    // respuesta de este request (`finalText`), solo no queda etiquetado en la fila hasta que la
    // migración correspondiente esté aplicada. A diferencia de `projects.color` en F2 (que usa el
    // cache compartido de `schema-compat.ts` con TTL porque tiene muchos call-sites), acá se detecta
    // por intento directo sin cache: la ventana de "migración sin aplicar" es corta y de bajo
    // tráfico. OJO: hay OTRO retry de compat en el read-path del detalle (`app/t/[id]/page.tsx`), en
    // el dashboard (`app/page.tsx`) y en el dedupe de más arriba — todos independientes y sin cache a
    // propósito; si esto se volviera caliente, valdría unificarlos en un cache compartido como F2.
    let insertResult = await supabase
      .from("transcriptions")
      .insert({
        ...baseRow,
        translated_to: translatedTo,
        original_text: originalText,
        vocabulary_corrected: vocabularyCorrected,
        tags: autoTags,
      })
      .select("id")
      .single();
    tagsSaved = !insertResult.error;

    if (insertResult.error && isMissingColumnError(insertResult.error)) {
      insertResult = await supabase
        .from("transcriptions")
        .insert({
          ...baseRow,
          translated_to: translatedTo,
          original_text: originalText,
          vocabulary_corrected: vocabularyCorrected,
        })
        .select("id")
        .single();
    }

    if (insertResult.error && isMissingColumnError(insertResult.error)) {
      insertResult = await supabase
        .from("transcriptions")
        .insert({ ...baseRow, translated_to: translatedTo, original_text: originalText })
        .select("id")
        .single();
    }

    if (insertResult.error && isMissingColumnError(insertResult.error)) {
      insertResult = await supabase.from("transcriptions").insert(baseRow).select("id").single();
    }

    const { data: inserted, error: insertErr } = insertResult;
    if (insertErr) {
      console.error("[transcribe] transcription insert failed", {
        userId: user.id,
        error: insertErr.message,
      });
      Sentry.captureException(insertErr, {
        extra: { userId: user.id, stage: "transcription-insert" },
      });
    }
    savedId = inserted?.id ?? null;
  } catch (err) {
    // No bloqueamos la respuesta por un error de guardado, pero lo dejamos visible.
    console.error("[transcribe] transcription insert threw", err);
    Sentry.captureException(err, { extra: { userId: user.id, stage: "transcription-insert" } });
  }

  // `title`/`tags` viajan en la respuesta (mismos valores que se acaban de guardar en la fila, paso
  // 2.7 más arriba) para que la cola de `TranscribeWorkspace` pueda reflejar el título auto-generado
  // apenas termina de transcribir, sin que la usuaria tenga que entrar al detalle — bugfix UX
  // 2026-07-11 (antes la cola se quedaba mostrando el nombre de archivo original). Best-effort: si el
  // paso 2.7 no corrió o falló, `finalTitle` cae al título que mandó el cliente (el que ya mostraba
  // la cola). `tags` usa `tagsSaved` (no `autoTags` a ciegas) para nunca devolver tags que la fila
  // real no tiene — siempre `[]` en vez de `undefined`, así el front no necesita distinguir "no vino"
  // de "vino vacío".
  return NextResponse.json({
    text: finalText,
    id: savedId,
    audioStored: audioPath !== null,
    title: finalTitle,
    tags: tagsSaved ? autoTags : [],
    ...(translationWarning ? { translationWarning } : {}),
  });
}
