import { ImageResponse } from "next/og";
import { WaveformGlyph } from "./icons/waveform-glyph";

export const contentType = "image/png";

// Favicon / general app icon (browser tab, bookmarks, Android "any" purpose
// fallback). Same waveform mark as the dashboard header, brand-600 background.
//
// Two sizes instead of one: browsers pick whichever <link rel="icon"> best
// matches where they render it. A single 512px image gets downsampled for a
// 16-32px tab/bookmark icon and turns soft; shipping a purpose-built 32px
// version (compact 3-bar glyph, thicker bars — see WaveformGlyph) keeps the
// tab icon crisp, while 512px still covers larger contexts (e.g. desktop
// shortcuts) with the full 5-bar mark.
export function generateImageMetadata() {
  return [
    { id: "32", size: { width: 32, height: 32 } },
    { id: "512", size: { width: 512, height: 512 } },
  ];
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const iconId = await id;
  const isCompact = iconId === "32";
  const size = isCompact ? 32 : 512;

  return new ImageResponse(
    (
      <WaveformGlyph
        size={size}
        barCount={isCompact ? 3 : 5}
        scale={isCompact ? 0.6 : 0.43}
      />
    ),
    { width: size, height: size },
  );
}
