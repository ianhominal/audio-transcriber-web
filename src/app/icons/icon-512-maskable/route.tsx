import { ImageResponse } from "next/og";
import { WaveformGlyph } from "../waveform-glyph";

const SIZE = 512;

// Content never changes at runtime — build it once instead of on every request.
export const dynamic = "force-static";

/**
 * Maskable icon for Android adaptive icons. The glyph is scaled well within
 * the ~80% "safe zone" so it survives circle/squircle/teardrop masks — only
 * `scale` differs from the regular icons; background still fills the full
 * canvas edge-to-edge so the mask has no gaps to show through.
 */
export async function GET() {
  return new ImageResponse(<WaveformGlyph size={SIZE} scale={0.28} />, {
    width: SIZE,
    height: SIZE,
  });
}
