"use client";

import { createContext, useContext, useTransition, type ReactNode } from "react";
import { runSeoAnalysis } from "@/app/dashboard/sites/[slug]/actions";

type AnalysisPendingContextValue = {
  /**
   * True from the moment "Run SEO analysis" is triggered until the
   * resulting navigation (the Server Action's own `redirect()` back to
   * this same route once the crawl finishes, success or failure) has
   * fully resolved — `useTransition` keeps a transition pending through a
   * Server Action's `redirect()` by design, so this stays true for the
   * whole ~40s-worst-case crawl, not just until the request is sent.
   */
  isPending: boolean;
  run: (formData: FormData) => void;
};

const AnalysisPendingContext = createContext<AnalysisPendingContextValue | null>(null);

/**
 * Shares one pending flag between the "Run SEO analysis" button (which
 * triggers it) and the Current SEO Health card (which swaps to a skeleton
 * while it's true) — two non-adjacent parts of the same page tree.
 * `useTransition`, not `useFormStatus`, specifically because
 * `useFormStatus` can only be read by descendants of the same `<form>`,
 * and the health card isn't (and shouldn't become) one — this avoids
 * wrapping unrelated page content inside a form just to share state.
 *
 * Wraps the whole page body with no DOM of its own (a bare Context
 * Provider renders no element), so it changes nothing about layout.
 */
export function AnalysisPendingProvider({ children }: { children: ReactNode }) {
  const [isPending, startTransition] = useTransition();

  function run(formData: FormData) {
    startTransition(async () => {
      await runSeoAnalysis(formData);
    });
  }

  return (
    <AnalysisPendingContext.Provider value={{ isPending, run }}>
      {children}
    </AnalysisPendingContext.Provider>
  );
}

export function useAnalysisPending(): AnalysisPendingContextValue {
  const ctx = useContext(AnalysisPendingContext);
  if (!ctx) {
    throw new Error("useAnalysisPending must be used within AnalysisPendingProvider");
  }
  return ctx;
}
