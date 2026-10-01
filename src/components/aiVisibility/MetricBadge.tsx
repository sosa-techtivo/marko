/** Small tri-state badge for a nullable boolean metric — `null` renders as
 * a distinct "Not evaluated" state rather than being coerced into looking
 * like "No" (CLAUDE.md/this slice's explicit requirement: NULL must stay
 * distinguishable from a genuine negative result). */
export function MetricBadge({ label, value }: { label: string; value: boolean | null }) {
  const colors =
    value === true
      ? "border-green-200 bg-green-50 text-green-700"
      : value === false
        ? "border-zinc-300 bg-zinc-100 text-zinc-600"
        : "border-zinc-200 bg-zinc-50 text-zinc-400";
  const text = value === true ? "Yes" : value === false ? "No" : "Not evaluated";

  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${colors}`}>
      {label}: {text}
    </span>
  );
}
