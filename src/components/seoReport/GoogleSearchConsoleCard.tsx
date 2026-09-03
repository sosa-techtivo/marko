"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  associateSiteProperty,
  listAvailableProperties,
} from "@/app/dashboard/sites/[slug]/googleSearchConsoleActions";
import { findExactPropertyMatch } from "@/lib/googleSearchConsole/propertyMatching";
import type { GoogleConnectionStatus } from "@/lib/googleSearchConsole/connectionStatus";
import type { SiteSnapshotResult } from "@/lib/googleSearchConsole/siteSnapshot";
import { SummaryStat } from "./badges";

type SelectedProperty = { url: string; type: "url_prefix" | "domain" } | null;

/** Google's official "G" brand mark (the standard 4-color icon from
 * Google's own identity/branding guidelines) — reproduced verbatim, not
 * redrawn or approximated, purely to label this card as a Google
 * integration. No new dependency: it's static, inline SVG markup, the same
 * way every other icon in this file's badges already renders. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" width="14" height="14" aria-hidden="true" className="shrink-0">
      <path
        fill="#FFC107"
        d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12
        c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24
        c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
      />
      <path
        fill="#FF3D00"
        d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039
        l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36
        c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
      />
      <path
        fill="#1976D2"
        d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571
        c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
      />
    </svg>
  );
}

function formatMetric(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatCtr(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatPosition(value: number): string {
  return value.toFixed(1);
}

function formatDelta(value: number, format: (v: number) => string): string {
  if (value === 0) return `±${format(0).replace(/^-/, "")}`;
  return `${value > 0 ? "+" : "−"}${format(Math.abs(value))}`;
}

function formatDateRange(startDate: string, endDate: string): string {
  return `${startDate} to ${endDate}`;
}

/**
 * Automatic-only Search Console property matcher, shown once connected but
 * before a property is associated. Fetches the live property list on
 * mount — a one-time setup action, not something that runs on every page
 * load once a property is already associated — and persists the property
 * only when exactly one unambiguously matches the site's URL/domain.
 *
 * Deliberately has no manual picker: a MARKO Site must only ever show
 * Search Console data for the property genuinely associated with it, so
 * there is no way from this page to select — or even see — some other,
 * unrelated property on the connected Google account. When the match is
 * ambiguous or absent, this simply reports that fact; the only path to a
 * resolved property is a confident automatic match.
 */
function PropertyMatcher({
  siteId,
  siteUrl,
  onMatched,
}: {
  siteId: string;
  siteUrl: string;
  onMatched: (property: { url: string; type: "url_prefix" | "domain" }) => void;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "auto-matching" }
    | { status: "error"; message: string }
    | { status: "no-account-properties" }
    | { status: "no-confident-match" }
  >({ status: "loading" });

  // Read via a ref inside the effect below instead of listing `onMatched`
  // as a dependency — it's a fresh inline function on every parent render,
  // and re-running the effect (re-fetching + re-auto-saving) on every
  // unrelated parent re-render would be wrong.
  const onMatchedRef = useRef(onMatched);
  useEffect(() => {
    onMatchedRef.current = onMatched;
  }, [onMatched]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const result = await listAvailableProperties();
      if (cancelled) return;
      if (!result.ok) {
        setState({ status: "error", message: result.error });
        return;
      }

      if (result.properties.length === 0) {
        setState({ status: "no-account-properties" });
        return;
      }

      const match = findExactPropertyMatch(siteUrl, result.properties);
      if (!match) {
        setState({ status: "no-confident-match" });
        return;
      }

      setState({ status: "auto-matching" });
      const saveResult = await associateSiteProperty(siteId, match.siteUrl, match.type);
      if (cancelled) return;
      if (saveResult.ok) {
        onMatchedRef.current({ url: match.siteUrl, type: match.type });
        return;
      }
      setState({ status: "error", message: saveResult.error });
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [siteUrl, siteId]);

  if (state.status === "loading") {
    return <p className="mt-2 text-xs text-zinc-500">Loading available properties…</p>;
  }

  if (state.status === "auto-matching") {
    return <p className="mt-2 text-xs text-zinc-500">Matching Search Console property…</p>;
  }

  if (state.status === "error") {
    return <p className="mt-2 text-xs text-red-600">{state.message}</p>;
  }

  if (state.status === "no-account-properties") {
    return (
      <p className="mt-2 text-xs text-zinc-500">
        This Google account has no Search Console properties available.
      </p>
    );
  }

  return (
    <p className="mt-2 text-xs text-zinc-500">
      No Search Console property could be automatically matched to this site&rsquo;s URL/domain.
    </p>
  );
}

function SnapshotSection({ snapshot }: { snapshot: SiteSnapshotResult }) {
  if (snapshot.status === "not_connected") {
    return <p className="mt-2 text-xs text-zinc-500">Google Search Console is not connected.</p>;
  }
  if (snapshot.status === "needs_reauth") {
    return (
      <p className="mt-2 text-xs text-amber-800">
        Reconnect Google Search Console to see performance data.
      </p>
    );
  }
  if (snapshot.status === "error") {
    return <p className="mt-2 text-xs text-red-600">{snapshot.message}</p>;
  }

  const { current, delta, dateRanges } = snapshot.snapshot;

  if (!current.hasData) {
    return (
      <p className="mt-2 text-xs text-zinc-500">
        No Search Console data is available yet for{" "}
        {formatDateRange(dateRanges.current.startDate, dateRanges.current.endDate)}.
      </p>
    );
  }

  return (
    <div className="mt-2">
      <p className="text-xs text-zinc-500">
        Latest available 28 days: {formatDateRange(dateRanges.current.startDate, dateRanges.current.endDate)}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryStat label="Clicks" value={current.clicks} />
        <SummaryStat label="Impressions" value={current.impressions} />
        <div className="flex flex-col gap-1">
          <p className="text-xl font-semibold text-zinc-900">{formatCtr(current.ctr)}</p>
          <p className="text-xs text-zinc-500">CTR</p>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xl font-semibold text-zinc-900">{formatPosition(current.position)}</p>
          <p className="text-xs text-zinc-500">Average position</p>
        </div>
      </div>

      {delta && (
        <p className="mt-2 text-xs text-zinc-500">
          vs. previous 28 days ({formatDateRange(dateRanges.previous.startDate, dateRanges.previous.endDate)}):{" "}
          {formatDelta(delta.clicks, formatMetric)} clicks · {formatDelta(delta.impressions, formatMetric)}{" "}
          impressions · {formatDelta(delta.ctr, formatCtr)} CTR · {formatDelta(delta.position, formatPosition)}{" "}
          avg. position
        </p>
      )}
      {!delta && (
        <p className="mt-2 text-xs text-zinc-500">
          No comparable data for the previous 28 days yet.
        </p>
      )}
    </div>
  );
}

/**
 * Minimal UI to test the Search Console integration: connection state,
 * connect/reconnect action, and a plain factual metrics readout for the
 * property automatically matched to this site (see PropertyMatcher). There
 * is no manual property picker and no way to change/clear the associated
 * property from this page — the Search Console data shown for a Site must
 * always belong to the one property MARKO itself matched to it. Rendered
 * last in the Site context column, styled with lower visual weight
 * (smaller/muted heading, lighter border) than the cards above it — a
 * deliberate prominence reduction only; functionality and data are
 * otherwise unchanged.
 */
export function GoogleSearchConsoleCard({
  siteId,
  siteSlug,
  siteUrl,
  connection,
  initialProperty,
  snapshot,
}: {
  siteId: string;
  siteSlug: string;
  siteUrl: string;
  connection: GoogleConnectionStatus;
  initialProperty: SelectedProperty;
  snapshot: SiteSnapshotResult | null;
}) {
  const router = useRouter();
  const [property, setProperty] = useState<SelectedProperty>(initialProperty);

  const connectHref = useMemo(
    () => `/dashboard/google/connect?returnTo=${encodeURIComponent(`/dashboard/sites/${siteSlug}`)}`,
    [siteSlug],
  );

  return (
    <div className="rounded-lg border border-zinc-100 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
          <GoogleIcon />
          Search Console
        </h2>
        {!connection.connected && (
          <span className="inline-block rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600">
            Not connected
          </span>
        )}
        {connection.connected && connection.needsReauth && (
          <span className="inline-block rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
            Reconnect required
          </span>
        )}
        {connection.connected && !connection.needsReauth && (
          <span className="inline-block rounded-md border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
            Connected
          </span>
        )}
      </div>

      {!connection.connected && (
        <div className="mt-2">
          <p className="text-xs text-zinc-500">
            Connect a Google account to bring in organic search performance for this site.
          </p>
          <a
            href={connectHref}
            className="mt-2 inline-block rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Connect Google Search Console
          </a>
        </div>
      )}

      {connection.connected && connection.needsReauth && (
        <div className="mt-2">
          <p className="text-xs text-zinc-500">
            The Google connection needs to be re-authorized before MARKO can read Search Console
            data again.
          </p>
          <a
            href={connectHref}
            className="mt-2 inline-block rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Reconnect
          </a>
        </div>
      )}

      {connection.connected && !connection.needsReauth && (
        <>
          {property ? (
            <div className="mt-2">
              <p className="text-xs font-medium text-zinc-900">Search Console · Connected</p>
              {snapshot && <SnapshotSection snapshot={snapshot} />}
            </div>
          ) : (
            <PropertyMatcher
              siteId={siteId}
              siteUrl={siteUrl}
              onMatched={(matched) => {
                setProperty(matched);
                // Pulls the freshly-computed performance snapshot for this
                // property from the server.
                router.refresh();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
