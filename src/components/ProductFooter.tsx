/**
 * MARKO's product signature — the exact copy/link established for the
 * authenticated dashboard shell, reused as-is on the public landing page
 * so the same footer appears everywhere rather than two independent
 * copies of the same marketing string drifting apart over time.
 *
 * Deliberately a plain block-level element, not `fixed`/`sticky` — the
 * caller is expected to place it as a normal-flow sibling after its main
 * content inside a `min-h-screen flex-col` shell (see dashboard/layout.tsx
 * and the landing page) so it settles at the bottom of the viewport on a
 * short page without ever overlapping a long/scrollable one.
 */
export function ProductFooter() {
  return (
    <footer className="shrink-0 border-t border-zinc-200 px-6 py-3 text-center text-[11px] text-zinc-400">
      MARKO by{" "}
      <a
        href="https://www.techtivo.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="text-zinc-400 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-600"
      >
        Techtivo
      </a>{" "}
      — Smarter marketing. Clearer decisions.
    </footer>
  );
}
