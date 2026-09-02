"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SiteFavicon } from "@/components/SiteFavicon";
import { SITE_HEALTH_STATUS_LABELS, type SiteHealthStatus } from "@/lib/reporting/siteHealthStatus";

/** A site's dashboard card, fully pre-derived server-side (page.tsx) from
 * the existing health/bot-protection logic — this component only filters
 * and renders, it never re-derives SEO health or bot-block status itself. */
export type SiteCardData = {
  id: string;
  name: string;
  url: string;
  faviconUrl: string | null;
  isBlocked: boolean;
  status: SiteHealthStatus;
  /** Combines `isBlocked`/`status` into the single value the status filter
   * compares against — still just a label over the existing derivation. */
  filterStatus: SiteHealthStatus | "analysis_blocked";
  pagesAnalyzed: number;
  totalOpportunities: number;
  highPriorityIssues: number;
  footerText: string;
  hasHistoricalReport: boolean;
  historicalLabel: string | null;
};

const HEALTH_STYLES: Record<SiteHealthStatus, { badge: string; dot: string; needleColor: string }> = {
  healthy: { badge: "bg-green-50 text-green-700", dot: "bg-green-500", needleColor: "#15803d" },
  needs_attention: {
    badge: "bg-amber-50 text-amber-700",
    dot: "bg-amber-500",
    needleColor: "#b45309",
  },
  critical: { badge: "bg-red-50 text-red-700", dot: "bg-red-500", needleColor: "#b91c1c" },
  not_analyzed: { badge: "bg-zinc-100 text-zinc-500", dot: "bg-zinc-400", needleColor: "#a1a1aa" },
};

function HealthIndicator({ status }: { status: SiteHealthStatus }) {
  const styles = HEALTH_STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${styles.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} aria-hidden="true" />
      {SITE_HEALTH_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Header-row badge for a latest attempt blocked by bot/WAF protection (see
 * src/lib/crawler/botProtection.ts) — same pill shape/size as
 * HealthIndicator, but amber and with no Healthy/Needs attention/Critical
 * wording: this state means MARKO couldn't measure the site at all, not
 * that it measured something bad.
 */
function AnalysisBlockedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
      Analysis blocked
    </span>
  );
}

// Gauge geometry: a semicircle centered at (CX, CY) with radius R, arc
// running from 180° (left) up through 90° (top) to 0° (right). Split into
// three equal 60° zones: critical (180→120), needs_attention (120→60),
// healthy (60→0). Unchanged from before — only the *rendered* width/height
// below were increased; the underlying zone/needle geometry and mapping
// are untouched.
const GAUGE_CX = 60;
const GAUGE_CY = 54;
const GAUGE_R = 44;
const GAUGE_STROKE = 10;
const NEEDLE_LENGTH = 32;

function gaugePoint(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: GAUGE_CX + radius * Math.cos(rad), y: GAUGE_CY - radius * Math.sin(rad) };
}

function zoneArcPath(fromDeg: number, toDeg: number) {
  const p1 = gaugePoint(fromDeg, GAUGE_R);
  const p2 = gaugePoint(toDeg, GAUGE_R);
  return `M ${p1.x} ${p1.y} A ${GAUGE_R} ${GAUGE_R} 0 0 1 ${p2.x} ${p2.y}`;
}

// Needle angle points into the middle of the zone matching the current
// status; "not_analyzed" rests straight up (90°) over an all-gray gauge
// with no colored zones, so it has no semantic position to point at.
const GAUGE_NEEDLE_ANGLE: Record<SiteHealthStatus, number> = {
  critical: 150,
  needs_attention: 90,
  healthy: 30,
  not_analyzed: 90,
};

// The three zones are always shown in their fixed semantic colors (like a
// real speedometer) — only the needle's position/color changes with
// status. "not_analyzed" is the one exception: the whole gauge (zones and
// needle) turns neutral gray, since there's no colored zone to mean
// anything yet.
const GAUGE_ZONE_COLORS = { critical: "#ef4444", attention: "#f59e0b", healthy: "#22c55e" }; // red/amber/green-500
const GAUGE_ZONE_COLORS_NEUTRAL = { critical: "#d4d4d8", attention: "#d4d4d8", healthy: "#d4d4d8" }; // zinc-300

/**
 * Semicircular gauge — a pure visual representation of the existing
 * categorical SiteHealthStatus. No numbers, no new scoring: the needle
 * position is fixed per status (see GAUGE_NEEDLE_ANGLE), not computed from
 * any score. Rendered larger than the previous pass (98x50, up from
 * 78x40) for at-a-glance legibility; nearby spacing was tightened to
 * absorb the increase without growing the card (see SitesGrid below).
 */
function SiteHealthGauge({ status }: { status: SiteHealthStatus }) {
  const isNeutral = status === "not_analyzed";
  const zoneColors = isNeutral ? GAUGE_ZONE_COLORS_NEUTRAL : GAUGE_ZONE_COLORS;
  const needleAngle = GAUGE_NEEDLE_ANGLE[status];
  const needleTip = gaugePoint(needleAngle, NEEDLE_LENGTH);
  const needleColor = isNeutral ? "#a1a1aa" : HEALTH_STYLES[status].needleColor;

  return (
    <svg
      viewBox="0 0 120 62"
      width="98"
      height="50"
      role="img"
      aria-label={`SEO health: ${SITE_HEALTH_STATUS_LABELS[status]}`}
    >
      <path
        d={zoneArcPath(180, 120)}
        fill="none"
        stroke={zoneColors.critical}
        strokeWidth={GAUGE_STROKE}
        strokeLinecap="round"
      />
      <path
        d={zoneArcPath(120, 60)}
        fill="none"
        stroke={zoneColors.attention}
        strokeWidth={GAUGE_STROKE}
        strokeLinecap="round"
      />
      <path
        d={zoneArcPath(60, 0)}
        fill="none"
        stroke={zoneColors.healthy}
        strokeWidth={GAUGE_STROKE}
        strokeLinecap="round"
      />
      <line
        x1={GAUGE_CX}
        y1={GAUGE_CY}
        x2={needleTip.x}
        y2={needleTip.y}
        stroke={needleColor}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <circle cx={GAUGE_CX} cy={GAUGE_CY} r={3.5} fill={needleColor} />
    </svg>
  );
}

function Stat({ label, value, emphasize }: { label: string; value: number; emphasize?: boolean }) {
  return (
    <div className="text-center">
      <p
        className={`text-sm leading-tight font-semibold ${emphasize ? "text-red-600" : "text-zinc-900"}`}
      >
        {value}
      </p>
      <p className="text-[10px] leading-tight text-zinc-500">{label}</p>
    </div>
  );
}

const STATUS_FILTER_OPTIONS: { value: "all" | SiteHealthStatus | "analysis_blocked"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "healthy", label: "Healthy" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "critical", label: "Critical" },
  { value: "analysis_blocked", label: "Analysis blocked" },
  { value: "not_analyzed", label: "Not analyzed" },
];

function SiteCard({ site }: { site: SiteCardData }) {
  return (
    <Link
      href={`/dashboard/sites/${site.id}`}
      className="flex h-full flex-col rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition-shadow hover:border-zinc-300 hover:shadow-md"
    >
      {/* Header: favicon, name, URL — identity only, full width */}
      <div className="flex min-w-0 items-center gap-2.5">
        <SiteFavicon faviconUrl={site.faviconUrl} siteName={site.name} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900">{site.name}</p>
          <p className="truncate text-xs text-zinc-500">{site.url}</p>
        </div>
      </div>

      {/* Status: its own row — a narrow card can't fit this next to the name reliably */}
      <div className="mt-1.5">
        {site.isBlocked ? <AnalysisBlockedBadge /> : <HealthIndicator status={site.status} />}
      </div>

      {/* Main: gauge/warning, metrics in a compact 3-col grid below */}
      {site.isBlocked ? (
        <div className="mt-2 border-t border-zinc-100 pt-2">
          <div className="flex items-center gap-2">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[11px] font-semibold text-amber-700"
              aria-hidden="true"
            >
              !
            </span>
            <p className="text-[11px] text-amber-700">MARKO could not access this site.</p>
          </div>

          {site.hasHistoricalReport ? (
            <div className="mt-2">
              <p className="text-[10px] font-medium text-zinc-500">{site.historicalLabel}</p>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                <Stat label="Pages" value={site.pagesAnalyzed} />
                <Stat label="Opportunities" value={site.totalOpportunities} />
                <Stat label="High-priority" value={site.highPriorityIssues} />
              </div>
            </div>
          ) : (
            <p className="mt-2 text-[10px] text-zinc-400">No previous successful analysis.</p>
          )}
        </div>
      ) : (
        <div className="mt-2 border-t border-zinc-100 pt-2">
          <div className="flex justify-center">
            <SiteHealthGauge status={site.status} />
          </div>
          <div className="mt-1 grid grid-cols-3 gap-2">
            <Stat label="Pages" value={site.pagesAnalyzed} />
            <Stat label="Opportunities" value={site.totalOpportunities} />
            <Stat
              label="High-priority"
              value={site.highPriorityIssues}
              emphasize={site.highPriorityIssues > 0}
            />
          </div>
        </div>
      )}

      {/* Footer: timestamp above View report — stacked so it never wraps at this width */}
      <div className="mt-auto pt-2">
        <div className="border-t border-zinc-100 pt-2">
          <p className="text-[11px] text-zinc-500">{site.footerText}</p>
          <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary-strong">
            View report
            <span aria-hidden="true">→</span>
          </span>
        </div>
      </div>
    </Link>
  );
}

export function SitesGrid({ sites }: { sites: SiteCardData[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SiteHealthStatus | "analysis_blocked">("all");

  const filteredSites = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sites.filter((site) => {
      const matchesSearch =
        query === "" ||
        site.name.toLowerCase().includes(query) ||
        site.url.toLowerCase().includes(query);
      const matchesStatus = statusFilter === "all" || site.filterStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [sites, search, statusFilter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search sites..."
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
        <select
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as "all" | SiteHealthStatus | "analysis_blocked")
          }
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 sm:w-56"
        >
          {STATUS_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {filteredSites.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <p className="text-sm text-zinc-500">No sites match your filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {filteredSites.map((site) => (
            <SiteCard key={site.id} site={site} />
          ))}
        </div>
      )}
    </div>
  );
}
