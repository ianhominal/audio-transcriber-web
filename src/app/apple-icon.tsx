import { ImageResponse } from "next/og";
import { WaveformGlyph } from "./icons/waveform-glyph";

// Image metadata
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS home-screen icon. Solid background, no transparency and no pre-baked
// corner rounding — Safari applies its own squircle mask, and a transparent
// or already-rounded source produces artifacts on the home screen.
export default function AppleIcon() {
  return new ImageResponse(<WaveformGlyph size={size.width} />, { ...size });
}
