"use client";

import { useFormStatus } from "react-dom";

/** A plain `<button type="submit">` that disables itself and swaps its
 * label while its enclosing `<form>`'s Server Action is in flight — the
 * smallest useful pending affordance for a form that redirects on
 * completion (no shared cross-component pending context needed, unlike
 * RunAnalysisButton on the SEO report page). */
export function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}
