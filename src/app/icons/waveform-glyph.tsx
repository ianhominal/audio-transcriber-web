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
// The 3-bar variant is a simplified version of the same silhouette (low-high-low),
// used where 5 thin bars would blur together — e.g. a 32px browser-tab favicon.
const BAR_HEIGHT_RATIOS: Record<3 | 5, number[]> = {
  5: [0.4, 0.7, 1, 0.7, 0.5],
  3: [0.55, 1, 0.55],
};

type WaveformGlyphProps = {
  /** Canvas size in pixels (square icons only). */
  size: number;
  /** Fraction of the canvas the tallest bar occupies. Smaller = more padding around the glyph. */
  scale?: number;
  background?: string;
  barColor?: string;
  /** Corner rounding of the background square, in pixels. 0 = sharp square. */
  radius?: number;
  /**
   * Number of bars in the mark. 5 (default) is the full waveform used by the
   * dashboard header, apple-touch icon and PWA manifest icons. 3 is a compact
   * variant for tiny canvases (favicon tab icon) where 5 hairline bars would
   * turn into a gray smudge once the browser downsamples them.
   */
  barCount?: 3 | 5;
  /** Bar width as a fraction of the tallest bar's height. Defaults are thinner
   * for the 5-bar mark and thicker for the 3-bar compact mark, so small sizes
   * stay legible instead of rendering hairline bars. */
  barWidthRatio?: number;
  /** Gap between bars as a fraction of the tallest bar's height. */
  gapRatio?: number;
};

export function WaveformGlyph({
  size,
  scale = 0.43,
  background = "#4f46e5",
  barColor = "#ffffff",
  radius = 0,
  barCount = 5,
  barWidthRatio = barCount === 3 ? 0.32 : 0.21,
  gapRatio = 0.09,
}: WaveformGlyphProps) {
  const ratios = BAR_HEIGHT_RATIOS[barCount];
  const barMaxHeight = size * scale;
  const barWidth = barMaxHeight * barWidthRatio;
  const gap = barMaxHeight * gapRatio;

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
        {ratios.map((ratio, i) => (
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
