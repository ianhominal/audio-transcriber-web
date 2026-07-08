/**
 * Shared JSX glyph used by every generated app icon (favicon, apple-touch-icon,
 * and the PWA manifest icons). Mirrors the waveform mark used in the dashboard
 * header (see `WaveIcon` in `src/app/app/layout.tsx`) so the installed app icon
 * matches the in-app brand mark. Not a Next.js file-convention route itself —
 * it's imported by `icon.tsx`, `apple-icon.tsx`, and the `/icons/*` route
 * handlers that back the manifest's `icons` array.
 */

// Relative bar heights, same proportions as the inline SVG waveform in the
// dashboard header (source values [8, 14, 20, 14, 10] out of a 20 max).
const BAR_HEIGHT_RATIOS = [0.4, 0.7, 1, 0.7, 0.5];

type WaveformGlyphProps = {
  /** Canvas size in pixels (square icons only). */
  size: number;
  /** Fraction of the canvas the tallest bar occupies. Smaller = more padding around the glyph. */
  scale?: number;
  background?: string;
  barColor?: string;
  /** Corner rounding of the background square, in pixels. 0 = sharp square. */
  radius?: number;
};

export function WaveformGlyph({
  size,
  scale = 0.43,
  background = "#4f46e5",
  barColor = "#ffffff",
  radius = 0,
}: WaveformGlyphProps) {
  const barMaxHeight = size * scale;
  const barWidth = barMaxHeight * 0.21;
  const gap = barMaxHeight * 0.09;

  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background,
        borderRadius: radius,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap }}>
        {BAR_HEIGHT_RATIOS.map((ratio, i) => (
          <div
            key={i}
            style={{
              width: barWidth,
              height: barMaxHeight * ratio,
              background: barColor,
              borderRadius: barWidth / 2,
            }}
          />
        ))}
      </div>
    </div>
  );
}
