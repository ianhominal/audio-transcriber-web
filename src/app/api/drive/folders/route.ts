import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api";
import { listFolderChildren, isDriveFolder, getFolderById, DriveApiError } from "@/lib/drive/api";
import { getUserDriveAccessToken, DriveNotConnectedError } from "@/lib/drive/connection";

export const runtime = "nodejs";

/**
 * Selector de carpetas de Drive, server-side (doc 10, Fase de importación): devuelve las
 * subcarpetas DIRECTAS de `parent` (o de la raíz "Mi unidad" si no se pasa `parent`, con el alias
 * `root` que entiende la Drive API). Lo usa el modal "Conectar carpeta de Drive" en Ajustes para
 * armar un árbol navegable, sin depender del Google Picker: el token del browser (GIS) tiene el
 * scope `drive.file`, insuficiente para recorrer carpetas ajenas — el access token server-side
 * (renovado acá desde el refresh token con scope `drive` completo) sí puede.
 */
export async function GET(req: NextRequest) {
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

  // `?id=` resuelve UNA carpeta por su id (link pegado a mano) en vez de listar hijos. Es el único
  // camino a una carpeta COMPARTIDA con el usuario: el navegador de abajo desciende desde `root`
  // ("Mi unidad") y una carpeta compartida no es hija de root — vive en "Compartido conmigo", así
  // que navegando nunca aparece. El id ya viene validado en forma por `parseDriveFolderId`
  // (`src/lib/drive/folder-link.ts`), pero eso es UI: acá se verifica contra Drive de verdad, que es
  // lo único que puede decir si existe, si es accesible y si es una carpeta.
  const folderId = req.nextUrl.searchParams.get("id");
  const parent = req.nextUrl.searchParams.get("parent") || "root";

  try {
    const accessToken = await getUserDriveAccessToken(supabase, user.id, { clientId, clientSecret, tokenKey });

    if (folderId) {
      const folder = await getFolderById(accessToken, folderId);
      if (!folder) {
        return NextResponse.json(
          { error: "Ese link no es de una carpeta de Drive (o la carpeta está en la papelera).", code: "not-a-folder" },
          { status: 400 }
        );
      }
      return NextResponse.json({ folder });
    }

    const children = await listFolderChildren(accessToken, parent);
    const folders = children
      .filter(isDriveFolder)
      .map((f) => ({ id: f.id, name: f.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));

    return NextResponse.json({ folders });
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
    console.error("[api/drive/folders] error inesperado:", err);
    return NextResponse.json({ error: "No se pudieron listar las carpetas de Drive." }, { status: 500 });
  }
}
