import type { MetadataRoute } from "next";
import { SHARE_TARGET_FILE_FIELD } from "@/lib/share-target";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Audio Transcriber",
    short_name: "Transcriber",
    description: "Transcribí tus audios a texto en segundos, en español, directo desde el celular.",
    start_url: "/app",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#4f46e5",
    lang: "es",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: "/icons/icon-192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Captura sin fricción (ver brainstorm homónimo): mantener apretado el ícono de la app
    // instalada muestra este acceso directo, que salta derecho a `/app/capturar` (arranca a grabar
    // solo, ver `capture-workspace.tsx`) — sin pasar por el dashboard ni el selector de proyecto.
    shortcuts: [
      {
        name: "Grabar",
        short_name: "Grabar",
        description: "Empezar a grabar una idea al toque, sin pasos de más.",
        url: "/app/capturar",
        icons: [{ src: "/icons/icon-192", sizes: "192x192", type: "image/png" }],
      },
    ],
    // Share Target (Level 2, archivos): permite compartir un audio desde otra app (WhatsApp, una
    // grabadora, el explorador de archivos) DIRECTO a esta PWA instalada, sin pasar por el
    // navegador. `method`/`enctype` son obligatorios así apenas se declara `files` (si no, el
    // share target se ignora silenciosamente) — sintaxis verificada contra MDN
    // (https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target)
    // y el tipo `Manifest["share_target"]` de Next (`next/dist/lib/metadata/types/manifest-types.d.ts`).
    // El campo `name` de `files` ("file") tiene que matchear el `form.get("file")`/`form.getAll("file")`
    // que lee `src/app/api/share-target/route.ts` — ver ese archivo. Soporte limitado a Chromium
    // (Android/ChromeOS/desktop instalado): en navegadores sin este feature, la PWA simplemente no
    // aparece como destino al compartir — degrada sin romper nada.
    share_target: {
      action: "/api/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        files: [
          {
            name: SHARE_TARGET_FILE_FIELD,
            accept: [
              "audio/*",
              ".mp3",
              ".wav",
              ".ogg",
              ".opus",
              ".m4a",
              ".mp4",
              ".mpeg",
              ".mpga",
              ".flac",
              ".webm",
            ],
          },
        ],
      },
    },
  };
}
