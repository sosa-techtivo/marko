export type SeoProgressPoint = {
  /** ISO timestamp of the completed analysis this point represents. */
  date: string;
  /** Same figure as the "Total opportunities" stat elsewhere in the
   * report — the raw count of persisted crawl_issues for that run. */
  totalOpportunities: number;
  /** Same figure as the "High-priority issues" stat — issues whose
   * ISSUE_TAXONOMY priority is "high". */
  highPriorityIssues: number;
};

// Sized for a compact ~1/4-width dashboard card (see the site detail
// page's ROW 1, a 4-column grid) — narrower than the ~1/3-width column
// this chart previously lived in, so the padding/font sizes below were
// tightened further to match. Pure coordinate space, not on-screen
// pixels: the SVG still scales to whatever width its container gives it
// (see the `w-full h-auto` below), but this ratio + padding is what keeps
// the *rendered* result compact and readable instead of proportionally
// tall or too cramped for its labels.
const WIDTH = 280;
const HEIGHT = 90;
const PADDING_LEFT = 20;
const PADDING_RIGHT = 5;
const PADDING_TOP = 6;
const PADDING_BOTTOM = 14;
const PLOT_WIDTH = WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_HEIGHT = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Simple, dependency-free inline-SVG line chart — the same hand-rolled-SVG
 * approach SiteHealthGauge already uses for the dashboard cards, just for
 * a trend over time instead of a single categorical reading. No charting
 * library, no image generation: two <path> polylines plotted from the
 * actual persisted per-run totals passed in by the caller (see
 * getCrawlRunDetail/deriveSiteHealthSummary in the site detail page) —
 * nothing here computes or invents a score.
 */
export function SeoProgressChart({ points }: { points: SeoProgressPoint[] }) {
  const maxValue = Math.max(
    1,
    ...points.flatMap((point) => [point.totalOpportunities, point.highPriorityIssues]),
  );
  // Round the axis ceiling up to a "nice" multiple of 5 for cleaner gridlines.
  const axisMax = Math.max(5, Math.ceil(maxValue / 5) * 5);

  const xFor = (index: number) =>
    points.length <= 1
      ? PADDING_LEFT + PLOT_WIDTH / 2
      : PADDING_LEFT + (index / (points.length - 1)) * PLOT_WIDTH;
  const yFor = (value: number) => PADDING_TOP + PLOT_HEIGHT - (value / axisMax) * PLOT_HEIGHT;

  const linePath = (key: "totalOpportunities" | "highPriorityIssues") =>
    points.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(point[key])}`).join(" ");

  // Avoid crowding the x-axis in a narrow card: label every point when
  // there are few, else just the first and last.
  const labeledIndexes = new Set(
    points.length <= 4 ? points.map((_, index) => index) : [0, points.length - 1],
  );

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        className="h-auto w-full"
        role="img"
        aria-label="SEO progress over time: total opportunities and high-priority issues per analysis"
      >
        {(() => {
          const y = yFor(axisMax);
          return (
            <g>
              <line
                x1={PADDING_LEFT}
                y1={y}
                x2={WIDTH - PADDING_RIGHT}
                y2={y}
                stroke="#e4e4e7"
                strokeWidth={1}
              />
              <text
                x={PADDING_LEFT - 4}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={8}
                fill="#a1a1aa"
              >
                {axisMax}
              </text>
            </g>
          );
        })()}
        <line
          x1={PADDING_LEFT}
          y1={PADDING_TOP + PLOT_HEIGHT}
          x2={WIDTH - PADDING_RIGHT}
          y2={PADDING_TOP + PLOT_HEIGHT}
          stroke="#d4d4d8"
          strokeWidth={1}
        />

        <path
          d={linePath("highPriorityIssues")}
          fill="none"
          stroke="#b45309"
          strokeWidth={1.5}
          strokeDasharray="3 2"
          strokeLinejoin="round"
        />
        <path
          d={linePath("totalOpportunities")}
          fill="none"
          stroke="#339595"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {points.map((point, index) => (
          <g key={point.date}>
            <circle cx={xFor(index)} cy={yFor(point.highPriorityIssues)} r={1.7} fill="#b45309" />
            <circle cx={xFor(index)} cy={yFor(point.totalOpportunities)} r={2.2} fill="#339595" />
            {labeledIndexes.has(index) && (
              <text
                x={xFor(index)}
                y={HEIGHT - 4}
                textAnchor="middle"
                fontSize={8}
                fill="#71717a"
              >
                {formatShortDate(point.date)}
              </text>
            )}
          </g>
        ))}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-primary" aria-hidden="true" />
          Total opportunities
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-amber-700" aria-hidden="true" />
          High-priority issues
        </span>
      </div>
    </div>
  );
}
