import { createHash } from "crypto";

/**
 * Hash (sha256 hex) del texto EXACTO que se resumió, guardado en
 * `transcriptions.summary_source_hash` junto con el resumen (ver migración
 * `20260709220000_transcription_summary.sql`). Sirve para invalidar el resumen cacheado sin
 * duplicar el texto completo en una segunda columna (alternativa descartada: guardar una copia de
 * `text` como hace `original_text` en F4 — acá no hace falta mostrar ese texto en ningún lado,
 * solo compararlo, así que un hash alcanza y es más liviano).
 *
 * SERVER-ONLY (usa `crypto` de Node) — se importa desde `/api/summarize/route.ts` y desde
 * `app/t/[id]/page.tsx` (ambos corren en el servidor), NUNCA desde `transcription-detail.tsx`
 * (client component).
 */
export function hashSummarySource(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}
