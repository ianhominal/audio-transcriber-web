import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { createFolder, DriveApiError } from "@/lib/drive/api";
import { getUserDriveAccessToken, DriveNotConnectedError } from "@/lib/drive/connection";
import { validateNewFolderName } from "@/lib/drive/folder-connect";

export const runtime = "nodejs";

type CreateBody = { parentId?: unknown; name?: unknown };

/**
 * Crea una carpeta NUEVA en Drive dentro de `parentId` (doc 10, UX fix: el modal "Conectar carpeta
 * de Drive" en Ajustes solo dejaba elegir carpetas EXISTENTES, sin forma de crear una desde cero).
 * Reusa `createFolder` (`files.create` con mimeType de carpeta), ya usado por el motor de sync para
 * crear la carpeta raíz del usuario.
 *
 * Solo crea — NO conecta. El modal decide qué hacer con la carpeta recién creada (mostrarla en la
 * lista para entrar y, eventualmente, llamar a `/api/drive/folders/connect`).
 */
export async function POST(req: NextRequest) {
  const { supabase, user } = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const tokenKey = process.env.DRIVE_TOKEN_KEY;
  if (!clientId || !clientSecret || !tokenKey) {
    return NextResponse.json({ error: "Falta configuración de Drive en el servidor." }, { status: 500 });
  }

  const body: CreateBody = await req.json().catch(() => ({}) as CreateBody);
  const parentId = typeof body.parentId === "string" ? body.parentId.trim() : "";
  if (!parentId) {
    return NextResponse.json({ error: "Falta parentId." }, { status: 400 });
  }
  const parsedName = validateNewFolderName(typeof body.name === "string" ? body.name : "");
  if (!parsedName.ok) {
    return NextResponse.json({ error: parsedName.error }, { status: 400 });
  }

  try {
    const accessToken = await getUserDriveAccessToken(supabase, user.id, { clientId, clientSecret, tokenKey });
    const folder = await createFolder(accessToken, parsedName.value, parentId);
    return NextResponse.json({ id: folder.id, name: folder.name });
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
    console.error("[api/drive/folders/create] error inesperado:", err);
    return NextResponse.json({ error: "No se pudo crear la carpeta en Drive." }, { status: 500 });
  }
}
