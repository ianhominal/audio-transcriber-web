import { ImageResponse } from "next/og";
import { WaveformGlyph } from "../waveform-glyph";

const SIZE = 512;

// Content never changes at runtime — build it once instead of on every request.
export const dynamic = "force-static";

/**
 * Stable, hand-written URL for the manifest's 512x512 "any" purpose icon.
 * Same glyph as `src/app/icon.tsx`, generated separately so the manifest
 * never depends on Next's internal (hashed) file-convention route URL.
 */
export async function GET() {
  return new ImageResponse(<WaveformGlyph size={SIZE} />, {
    width: SIZE,
    height: SIZE,
  });
}
