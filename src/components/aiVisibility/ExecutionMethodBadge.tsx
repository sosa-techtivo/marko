/** Which acquisition method produced an AI Visibility run — "API" or
 * "Browser" — so runs of the two methods can be told apart at a glance. */
export function ExecutionMethodBadge({ method }: { method: string }) {
  const label = method === "browser" ? "Browser" : method === "api" ? "API" : method;
  return (
    <span className="inline-block shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-zinc-600 uppercase">
      {label}
    </span>
  );
}
