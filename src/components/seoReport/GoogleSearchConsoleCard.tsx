"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  associateSiteProperty,
  clearSiteProperty,
  listAvailableProperties,
} from "@/app/dashboard/sites/[siteId]/googleSearchConsoleActions";
import { findExactPropertyMatch } from "@/lib/googleSearchConsole/propertyMatching";
import type { SearchConsoleProperty } from "@/lib/googleSearchConsole/propertyMatching";
import type { GoogleConnectionStatus } from "@/lib/googleSearchConsole/connectionStatus";
import type { SiteSnapshotResult } from "@/lib/googleSearchConsole/siteSnapshot";
import { SummaryStat } from "./badges";

type SelectedProperty = { url: string; type: "url_prefix" | "domain" } | null;

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

/** Property selector shown once connected but before a property is chosen
 * (or when the user asks to change it). Fetches the live property list on
 * mount — a one-time setup action, not something that runs on every page
 * load once a property is already associated. */
function PropertySelector({
  siteId,
  siteUrl,
  onSaved,
  onCancel,
  canCancel,
}: {
  siteId: string;
  siteUrl: string;
  onSaved: (property: { url: string; type: "url_prefix" | "domain" }) => void;
  onCancel: () => void;
  canCancel: boolean;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "loaded"; properties: SearchConsoleProperty[] }
  >({ status: "loading" });
  const [selectedUrl, setSelectedUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAvailableProperties().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState({ status: "error", message: result.error });
        return;
      }
      setState({ status: "loaded", properties: result.properties });
      // Pre-select the dropdown only when there's exactly one unambiguous
      // exact match — never silently saved without the user confirming.
      const match = findExactPropertyMatch(siteUrl, result.properties);
      if (match) setSelectedUrl(match.siteUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [siteUrl]);

  async function handleSave() {
    if (state.status !== "loaded") return;
    const property = state.properties.find((p) => p.siteUrl === selectedUrl);
    if (!property) return;

    setSaving(true);
    setSaveError(null);
    const type = property.siteUrl.startsWith("sc-domain:") ? "domain" : "url_prefix";
    const result = await associateSiteProperty(siteId, property.siteUrl, type);
    setSaving(false);

    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    onSaved({ url: property.siteUrl, type });
  }

  if (state.status === "loading") {
    return <p className="mt-2 text-xs text-zinc-500">Loading available properties…</p>;
  }

  if (state.status === "error") {
    return <p className="mt-2 text-xs text-red-600">{state.message}</p>;
  }

  if (state.properties.length === 0) {
    return (
      <p className="mt-2 text-xs text-zinc-500">
        This Google account has no Search Console properties available.
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-zinc-700">Search Console property</span>
        <select
          value={selectedUrl}
          onChange={(event) => setSelectedUrl(event.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        >
          <option value="" disabled>
            Choose a property…
          </option>
          {state.properties.map((property) => (
            <option key={property.siteUrl} value={property.siteUrl}>
              {property.siteUrl}
            </option>
          ))}
        </select>
      </label>
      {saveError && <p className="text-xs text-red-600">{saveError}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!selectedUrl || saving}
          className="self-start rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving…" : "Use this property"}
        </button>
        {canCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
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
          <p className="text-2xl font-semibold text-zinc-900">{formatCtr(current.ctr)}</p>
          <p className="text-xs text-zinc-500">CTR</p>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-2xl font-semibold text-zinc-900">{formatPosition(current.position)}</p>
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
 * connect/reconnect action, a property selector once connected, and a
 * plain factual metrics readout for the selected property. Deliberately
 * separate from the top ROW 1 card grid — this milestone does not
 * redesign the existing Site Report layout, only adds a new section.
 */
export function GoogleSearchConsoleCard({
  siteId,
  siteUrl,
  connection,
  initialProperty,
  snapshot,
}: {
  siteId: string;
  siteUrl: string;
  connection: GoogleConnectionStatus;
  initialProperty: SelectedProperty;
  snapshot: SiteSnapshotResult | null;
}) {
  const router = useRouter();
  const [property, setProperty] = useState<SelectedProperty>(initialProperty);
  const [changingProperty, setChangingProperty] = useState(false);
  const [clearing, setClearing] = useState(false);

  const connectHref = useMemo(
    () => `/dashboard/google/connect?returnTo=${encodeURIComponent(`/dashboard/sites/${siteId}`)}`,
    [siteId],
  );

  async function handleClearProperty() {
    setClearing(true);
    const result = await clearSiteProperty(siteId);
    setClearing(false);
    if (result.ok) {
      setProperty(null);
      setChangingProperty(true);
      // The performance snapshot is fetched server-side in page.tsx from
      // the now-cleared property — refresh so it disappears immediately
      // rather than showing stale data for the property just removed.
      router.refresh();
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">Search Console</h2>
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
          {property && !changingProperty ? (
            <div className="mt-2">
              <p className="text-xs text-zinc-500">
                Property:{" "}
                <span className="font-medium text-zinc-900">{property.url}</span>{" "}
                <span className="text-zinc-400">
                  ({property.type === "domain" ? "Domain" : "URL prefix"})
                </span>
              </p>
              <button
                type="button"
                onClick={handleClearProperty}
                disabled={clearing}
                className="mt-1 text-xs font-medium text-primary-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {clearing ? "Changing…" : "Change property"}
              </button>

              {snapshot && <SnapshotSection snapshot={snapshot} />}
            </div>
          ) : (
            <PropertySelector
              siteId={siteId}
              siteUrl={siteUrl}
              canCancel={property !== null}
              onCancel={() => setChangingProperty(false)}
              onSaved={(saved) => {
                setProperty(saved);
                setChangingProperty(false);
                // Pulls the freshly-computed performance snapshot for this
                // property from the server (see the note in
                // handleClearProperty above).
                router.refresh();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
