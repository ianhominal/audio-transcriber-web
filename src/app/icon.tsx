import { ImageResponse } from "next/og";
import { WaveformGlyph } from "./icons/waveform-glyph";

// Image metadata
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// Favicon / general app icon (browser tab, bookmarks, Android "any" purpose
// fallback). Same waveform mark as the dashboard header, brand-600 background.
export default function Icon() {
  return new ImageResponse(<WaveformGlyph size={size.width} />, { ...size });
}
