import { ImageResponse } from "next/og";
import { WaveformGlyph } from "../waveform-glyph";

const SIZE = 192;

// Content never changes at runtime — build it once instead of on every request.
export const dynamic = "force-static";

/**
 * Stable, hand-written URL (as opposed to the hashed URL Next.js generates for
 * the `icon.tsx`/`apple-icon.tsx` file-convention routes) so `manifest.ts` can
 * reference it directly. Backs the 192x192 "any" purpose entry.
 */
export async function GET() {
  return new ImageResponse(<WaveformGlyph size={SIZE} />, {
    width: SIZE,
    height: SIZE,
  });
}
