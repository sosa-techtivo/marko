import path from "node:path";
import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import type { SiteReportData } from "../siteReportData";
import type { SeoHealthReport, SeoOpportunity } from "../seoHealthReport";
import type { SeoChangeReport, ChangedIssue } from "../seoChangeReport";
import { CATEGORY_LABELS, PRIORITY_LABELS, type IssueCategory, type IssuePriority } from "../issueTaxonomy";
import { COLORS, PRIORITY_COLORS, PRIORITY_ACCENTS, STATUS_COLORS, STATUS_LABELS, styles } from "./theme";

const LOGO_PATH = path.join(process.cwd(), "public/branding/techtivo-marko.png");

/** How many representative affected-page URLs to show per opportunity in
 * the Priority Action Plan (page 3) — enough to be concrete evidence
 * without turning an action plan into a crawler log. The Technical
 * Appendix lists every affected page instead; see flattenOpportunities. */
const MAX_ACTION_PLAN_URLS = 3;
const MAX_RECOMMENDATIONS = 5;
const MAX_TOP_OPPORTUNITIES_PAGE1 = 2;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return "Unknown date";
  return new Date(iso).toLocaleString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatMetric(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}
function formatCtr(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
function formatPosition(value: number): string {
  return value.toFixed(1);
}
function formatDelta(value: number, format: (v: number) => string): string {
  if (value === 0) return `+/-${format(0).replace(/^-/, "")}`;
  return `${value > 0 ? "+" : "-"}${format(Math.abs(value))}`;
}

/** Whether a delta is an improvement — for most Search Console metrics a
 * higher number is better; for average position, lower is better. Purely
 * presentational (which color a delta badge gets); never changes a
 * reported number. */
function deltaTone(value: number, lowerIsBetter: boolean): "green" | "red" | "neutral" {
  if (value === 0) return "neutral";
  const improved = lowerIsBetter ? value < 0 : value > 0;
  return improved ? "green" : "red";
}

/**
 * Prominent, deterministic page-1 headline — a fixed lookup keyed off the
 * same `siteHealthStatus`/`health.summary` counts already computed by
 * `assembleSiteReportData` (same pattern as narrative.ts's sentences, and
 * STATUS_LABELS before it): no AI, no new scoring, no data this report
 * doesn't already show elsewhere as numbers.
 */
function buildHeadline(data: SiteReportData): string {
  if (!data.health) return "Your first SEO analysis is ready to review.";
  const { totalIssues, highPriorityIssues } = data.health.summary;
  switch (data.siteHealthStatus.status) {
    case "healthy":
      return totalIssues === 0
        ? "No critical SEO issues were found — your site is in strong shape."
        : "Your SEO foundation is solid, with a few opportunities to refine.";
    case "needs_attention":
      return `${totalIssues} SEO ${totalIssues === 1 ? "opportunity" : "opportunities"} identified to strengthen your search visibility.`;
    case "critical":
      return `${highPriorityIssues} high-priority ${highPriorityIssues === 1 ? "issue needs" : "issues need"} attention to protect your search visibility.`;
    default:
      return "Your first SEO analysis is ready to review.";
  }
}

// ---------------------------------------------------------------------------
// Shared primitives (badges, KPI cards, running header/footer, bars)
// ---------------------------------------------------------------------------

function PriorityBadge({ priority }: { priority: IssuePriority }) {
  const c = PRIORITY_COLORS[priority];
  return (
    <Text style={[styles.badge, { backgroundColor: c.bg, borderColor: c.border, color: c.text }]}>
      {PRIORITY_LABELS[priority]}
    </Text>
  );
}

function CategoryBadge({ category }: { category: IssueCategory }) {
  return (
    <Text
      style={[
        styles.badge,
        { backgroundColor: COLORS.zinc100, borderColor: COLORS.zinc300, color: COLORS.zinc600 },
      ]}
    >
      {CATEGORY_LABELS[category]}
    </Text>
  );
}

/** Compact running header shown on every page after the cover — the cover
 * carries its own full-width hero band instead of this. */
function RunningHeader({ siteName, dateLabel }: { siteName: string; dateLabel: string }) {
  return (
    <View style={styles.runningHeader} fixed>
      <Text style={styles.runningHeaderBrand}>MARKO SEO Report</Text>
      <Text>
        {siteName} · {dateLabel}
      </Text>
    </View>
  );
}

function RunningFooter() {
  return (
    <View style={styles.runningFooter} fixed>
      <Text>MARKO by Techtivo — Smarter marketing. Clearer decisions.</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

type KpiTone = "primary" | "amber" | "green" | "red" | "neutral";
const TONE_ACCENTS: Record<KpiTone, string> = {
  primary: COLORS.primary,
  amber: COLORS.amber500,
  green: COLORS.green500,
  red: COLORS.red500,
  neutral: COLORS.zinc300,
};

function KpiCard({
  label,
  value,
  tone = "primary",
  delta,
}: {
  label: string;
  value: string;
  tone?: KpiTone;
  delta?: { label: string; tone: "green" | "red" | "neutral" };
}) {
  return (
    <View style={[styles.kpiCard, { borderTopColor: TONE_ACCENTS[tone] }]}>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
      {delta && (
        <Text
          style={[
            styles.kpiDelta,
            { color: delta.tone === "green" ? COLORS.green700 : delta.tone === "red" ? COLORS.red700 : COLORS.zinc500 },
          ]}
        >
          {delta.label}
        </Text>
      )}
    </View>
  );
}

function DeltaBadge({ value, lowerIsBetter, unit }: { value: number; lowerIsBetter: boolean; unit: string }) {
  const tone = deltaTone(value, lowerIsBetter);
  const palette =
    tone === "green"
      ? { bg: COLORS.green50, text: COLORS.green700 }
      : tone === "red"
        ? { bg: COLORS.red50, text: COLORS.red700 }
        : { bg: COLORS.zinc100, text: COLORS.zinc600 };
  const label = value === 0 ? "No change" : `${value > 0 ? "+" : ""}${value} ${unit}`;
  return (
    <View style={{ backgroundColor: palette.bg, borderRadius: 3, paddingVertical: 2, paddingHorizontal: 6 }}>
      <Text style={{ fontSize: 8, fontWeight: 700, color: palette.text }}>{label}</Text>
    </View>
  );
}

/** A single-value proportion bar — used under the Resolved/New/Remaining
 * KPI cards. Purely visual; `value`/`max` are already-computed counts,
 * nothing new is derived here. */
function ProportionBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 4 : 0) : 0;
  return (
    <View style={{ marginTop: 6, height: 4, borderRadius: 2, backgroundColor: COLORS.zinc100 }}>
      <View style={{ width: `${pct}%`, height: 4, borderRadius: 2, backgroundColor: color }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// PAGE 1 — Executive Overview
// ---------------------------------------------------------------------------

function HeroBand({ data }: { data: SiteReportData }) {
  const showsEffectiveUrl =
    data.site.registeredUrlRedirectNote !== null && data.site.effectiveUrl !== data.site.registeredUrl;

  return (
    <View style={styles.heroBand}>
      <View style={styles.heroBrandRow}>
        {/* react-pdf's <Image> is a PDF-drawing primitive, not an HTML
            <img> — it has no `alt` prop; jsx-a11y's rule doesn't apply
            here, PDFs have their own separate accessibility model. Only
            `height` is set below — the source asset (public/branding/
            techtivo-marko.png) is a wide wordmark lockup, not square, so
            also fixing `width` would force the wrong aspect ratio. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image src={LOGO_PATH} style={{ height: 24 }} />
        <Text style={styles.heroWordmark}>MARKO</Text>
      </View>

      <Text style={styles.heroEyebrow}>SEO Performance Report</Text>
      <Text style={styles.heroTitle}>{data.site.name}</Text>

      <Text style={styles.heroMeta}>
        {data.site.registeredUrl}
        {showsEffectiveUrl ? `   ·   Effective URL: ${data.site.effectiveUrl}` : ""}
      </Text>
      <Text style={[styles.heroMeta, { marginTop: 2 }]}>
        Report generated {formatDate(data.generatedAt)}
        {data.latestCompletedRun
          ? `   ·   Latest analysis ${formatDate(data.latestCompletedRun.completedAt ?? data.latestCompletedRun.startedAt)}`
          : ""}
      </Text>
      {data.isShowingPreservedReport && (
        <Text style={[styles.heroMeta, { marginTop: 2 }]}>
          Note: the most recent analysis attempt did not complete successfully. This report reflects
          the last successful analysis.
        </Text>
      )}
    </View>
  );
}

function ExecutivePanel({ data }: { data: SiteReportData }) {
  const statusColors = STATUS_COLORS[data.siteHealthStatus.status];
  const topInsights = data.insights.slice(0, 2);

  return (
    <View style={[styles.panelTeal, styles.sectionSpacing]} wrap={false}>
      <View style={[styles.row, { alignItems: "center", gap: 8 }]}>
        <View style={[styles.badge, { backgroundColor: COLORS.white, borderColor: statusColors.border }]}>
          <Text style={{ fontSize: 8.5, color: statusColors.text, fontWeight: 700 }}>
            {STATUS_LABELS[data.siteHealthStatus.status]}
          </Text>
        </View>
        <Text style={styles.eyebrow}>Executive Summary</Text>
      </View>

      {data.executiveNarrative && (
        <Text style={{ fontSize: 9.5, color: COLORS.zinc700, marginTop: 8, lineHeight: 1.4 }}>
          {data.executiveNarrative}
        </Text>
      )}

      {topInsights.length > 0 && (
        <View style={{ marginTop: 8, gap: 3 }}>
          {topInsights.map((insight) => (
            <Text key={insight.id} style={{ fontSize: 8.5, lineHeight: 1.3 }}>
              <Text style={{ color: COLORS.primaryStrong, fontWeight: 700 }}>• {insight.title}. </Text>
              <Text style={{ color: COLORS.zinc700 }}>{insight.explanation}</Text>
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

/** Page 1's headline KPI grid — Pages analyzed / Opportunities /
 * High-priority issues always shown once a completed analysis exists;
 * Organic clicks / Impressions appended only when Search Console data is
 * actually present, so the grid gracefully adapts from 5 cards to 3
 * rather than showing empty/zeroed Search Console cards. */
function ExecutiveKpiGrid({ data }: { data: SiteReportData }) {
  if (!data.health) return null;
  const items: { label: string; value: string; tone?: KpiTone }[] = [
    { label: "Pages analyzed", value: formatMetric(data.health.summary.pagesAnalyzed) },
    { label: "Opportunities", value: formatMetric(data.health.summary.totalIssues) },
    {
      label: "High-priority issues",
      value: formatMetric(data.health.summary.highPriorityIssues),
      tone: data.health.summary.highPriorityIssues > 0 ? "amber" : "green",
    },
  ];
  if (data.searchConsole) {
    items.push({ label: "Organic clicks", value: formatMetric(data.searchConsole.snapshot.current.clicks) });
    items.push({ label: "Impressions", value: formatMetric(data.searchConsole.snapshot.current.impressions) });
  }

  return (
    <View style={[styles.row, { gap: 10, marginTop: 14 }]} wrap={false}>
      {items.map((item) => (
        <KpiCard key={item.label} {...item} />
      ))}
    </View>
  );
}

function CurrentHealthBlock({ data }: { data: SiteReportData }) {
  if (!data.health) return null;
  const statusColors = STATUS_COLORS[data.siteHealthStatus.status];
  const { pagesAnalyzed, pagesWithIssues } = data.health.summary;

  return (
    <View style={styles.sectionSpacing}>
      <Text style={styles.h2}>Current SEO Health</Text>
      <View style={[styles.row, { alignItems: "center", gap: 10 }]}>
        <View style={[styles.badge, { backgroundColor: statusColors.bg, borderColor: statusColors.border }]}>
          <Text style={{ fontSize: 9, color: statusColors.text, fontWeight: 700 }}>
            {STATUS_LABELS[data.siteHealthStatus.status]}
          </Text>
        </View>
        <Text style={{ fontSize: 9, color: COLORS.zinc700 }}>
          {pagesWithIssues} of {pagesAnalyzed} analyzed pages currently have at least one open finding.
        </Text>
      </View>

      {data.health.opportunities.length === 0 && data.health.positiveSignals.length > 0 && (
        <View style={[styles.card, { marginTop: 8, backgroundColor: COLORS.green50, borderColor: COLORS.green200 }]}>
          {data.health.positiveSignals.map((signal) => (
            <Text key={signal} style={{ fontSize: 8, color: COLORS.green700 }}>
              • {signal}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function TopOpportunityCard({ opportunity }: { opportunity: SeoOpportunity }) {
  return (
    <View
      style={[styles.card, { marginTop: 6, borderLeftWidth: 3, borderLeftColor: PRIORITY_ACCENTS[opportunity.priority] }]}
      wrap={false}
    >
      <View style={[styles.row, { gap: 4, alignItems: "center" }]}>
        <PriorityBadge priority={opportunity.priority} />
        <CategoryBadge category={opportunity.category} />
        <Text style={{ fontSize: 7.5, color: COLORS.zinc500 }}>
          {opportunity.affectedPages.length} page{opportunity.affectedPages.length === 1 ? "" : "s"} affected
        </Text>
      </View>
      <Text style={{ fontSize: 10, fontWeight: 700, marginTop: 4 }}>{opportunity.label}</Text>
      <Text style={{ fontSize: 8.5, color: COLORS.zinc700, marginTop: 2 }}>{opportunity.whyItMatters}</Text>
    </View>
  );
}

function TopOpportunitiesSection({ health }: { health: SeoHealthReport }) {
  const top = health.opportunities.slice(0, MAX_TOP_OPPORTUNITIES_PAGE1);
  if (top.length === 0) return null;

  return (
    <View style={styles.sectionSpacing}>
      <Text style={styles.h2}>Top Opportunities</Text>
      {top.map((opportunity) => (
        <TopOpportunityCard key={opportunity.issueType} opportunity={opportunity} />
      ))}
    </View>
  );
}

function MarkoRecommendsPanel({ health }: { health: SeoHealthReport }) {
  const top = health.opportunities.slice(0, 2);
  if (top.length === 0) return null;

  return (
    <View style={[styles.panelAmber, styles.sectionSpacing]} wrap={false}>
      <Text style={[styles.eyebrow, { color: COLORS.amber800 }]}>MARKO Recommends</Text>
      <View style={{ marginTop: 7, gap: 6 }}>
        {top.map((opportunity, i) => (
          <View key={opportunity.issueType} style={[styles.row, { gap: 6 }]}>
            <Text style={{ fontSize: 9, fontWeight: 700, color: COLORS.amber800, width: 12 }}>{i + 1}.</Text>
            <Text style={{ fontSize: 9, color: COLORS.zinc800, flex: 1, lineHeight: 1.35 }}>
              <Text style={{ fontWeight: 700 }}>{opportunity.label}: </Text>
              {opportunity.recommendedAction}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Page1({ data }: { data: SiteReportData }) {
  return (
    <Page size="A4" style={styles.page} wrap>
      <HeroBand data={data} />
      <Text style={styles.heroHeadline}>{buildHeadline(data)}</Text>

      {!data.latestCompletedRun ? (
        <View style={[styles.card, styles.sectionSpacing, { backgroundColor: COLORS.zinc50 }]}>
          <Text style={{ fontSize: 9, color: COLORS.zinc700 }}>
            No completed SEO analysis is available for this site yet. Run an analysis in MARKO to
            generate a full report.
          </Text>
        </View>
      ) : (
        <>
          <ExecutivePanel data={data} />
          <ExecutiveKpiGrid data={data} />
          <CurrentHealthBlock data={data} />
          {data.health && <TopOpportunitiesSection health={data.health} />}
          {data.health && <MarkoRecommendsPanel health={data.health} />}
        </>
      )}

      <RunningFooter />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// PAGE 2 — Performance & Progress
// ---------------------------------------------------------------------------

function SearchConsoleKpiSection({ searchConsole }: { searchConsole: SiteReportData["searchConsole"] }) {
  return (
    <View style={styles.sectionSpacing}>
      <Text style={styles.h2}>Organic Search Performance</Text>
      {!searchConsole ? (
        <View style={[styles.card, { backgroundColor: COLORS.zinc50 }]}>
          <Text style={{ fontSize: 9, color: COLORS.zinc700 }}>
            Google Search Console isn&apos;t connected for this site yet, so organic search
            performance isn&apos;t available in this report. Connect Search Console in MARKO to
            include clicks, impressions, CTR, and average position here.
          </Text>
        </View>
      ) : (
        <>
          <Text style={{ fontSize: 8, color: COLORS.zinc500 }}>
            Reporting period: {searchConsole.snapshot.dateRanges.current.startDate} to{" "}
            {searchConsole.snapshot.dateRanges.current.endDate}
          </Text>
          <View style={[styles.row, { gap: 10, marginTop: 10 }]} wrap={false}>
            <KpiCard
              label="Clicks"
              value={formatMetric(searchConsole.snapshot.current.clicks)}
              delta={
                searchConsole.snapshot.delta
                  ? {
                      label: `${formatDelta(searchConsole.snapshot.delta.clicks, formatMetric)} vs prior`,
                      tone: deltaTone(searchConsole.snapshot.delta.clicks, false),
                    }
                  : undefined
              }
            />
            <KpiCard
              label="Impressions"
              value={formatMetric(searchConsole.snapshot.current.impressions)}
              delta={
                searchConsole.snapshot.delta
                  ? {
                      label: `${formatDelta(searchConsole.snapshot.delta.impressions, formatMetric)} vs prior`,
                      tone: deltaTone(searchConsole.snapshot.delta.impressions, false),
                    }
                  : undefined
              }
            />
            <KpiCard
              label="CTR"
              value={formatCtr(searchConsole.snapshot.current.ctr)}
              delta={
                searchConsole.snapshot.delta
                  ? {
                      label: `${formatDelta(searchConsole.snapshot.delta.ctr, formatCtr)} vs prior`,
                      tone: deltaTone(searchConsole.snapshot.delta.ctr, false),
                    }
                  : undefined
              }
            />
            <KpiCard
              label="Avg. position"
              value={formatPosition(searchConsole.snapshot.current.position)}
              delta={
                searchConsole.snapshot.delta
                  ? {
                      label: `${formatDelta(searchConsole.snapshot.delta.position, formatPosition)} vs prior`,
                      tone: deltaTone(searchConsole.snapshot.delta.position, true),
                    }
                  : undefined
              }
            />
          </View>
          {!searchConsole.snapshot.delta && (
            <Text style={{ fontSize: 7.5, color: COLORS.zinc400, marginTop: 6 }}>
              No comparable previous-period data is available for this reporting period.
            </Text>
          )}
        </>
      )}
    </View>
  );
}

function SeoProgressKpis({ changeReport }: { changeReport: Extract<SeoChangeReport, { status: "compared" }> }) {
  const { resolvedCount, newCount, remainingCount } = changeReport.summary;
  const max = Math.max(resolvedCount, newCount, remainingCount, 1);

  return (
    <View style={[styles.row, { gap: 10 }]} wrap={false}>
      <View style={[styles.kpiCard, { borderTopColor: COLORS.green500 }]}>
        <Text style={styles.kpiValue}>{resolvedCount}</Text>
        <Text style={styles.kpiLabel}>Resolved</Text>
        <ProportionBar value={resolvedCount} max={max} color={COLORS.green500} />
      </View>
      <View style={[styles.kpiCard, { borderTopColor: COLORS.red500 }]}>
        <Text style={styles.kpiValue}>{newCount}</Text>
        <Text style={styles.kpiLabel}>New</Text>
        <ProportionBar value={newCount} max={max} color={COLORS.red500} />
      </View>
      <View style={[styles.kpiCard, { borderTopColor: COLORS.zinc400 }]}>
        <Text style={styles.kpiValue}>{remainingCount}</Text>
        <Text style={styles.kpiLabel}>Remaining</Text>
        <ProportionBar value={remainingCount} max={max} color={COLORS.zinc400} />
      </View>
    </View>
  );
}

function SeoProgressSection({ data }: { data: SiteReportData }) {
  const { changeReport, progressNarrative } = data;

  return (
    <View style={styles.sectionSpacing}>
      <Text style={styles.h2}>SEO Progress</Text>
      {!changeReport || changeReport.status !== "compared" ? (
        <Text style={{ fontSize: 9, color: COLORS.zinc500 }}>
          No comparable previous analysis is available yet. This is the first completed analysis for
          this site.
        </Text>
      ) : (
        <View>
          {progressNarrative && (
            <Text style={{ fontSize: 9.5, color: COLORS.zinc700, lineHeight: 1.4, marginBottom: 10 }}>
              {progressNarrative}
            </Text>
          )}

          <SeoProgressKpis changeReport={changeReport} />

          <View style={[styles.row, { gap: 24, alignItems: "center", marginTop: 16 }]} wrap={false}>
            <View>
              <Text style={styles.kpiLabel}>Pages with issues — previous</Text>
              <Text style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
                {changeReport.summary.previousPagesWithIssues}
              </Text>
            </View>
            <View>
              <Text style={styles.kpiLabel}>Current</Text>
              <Text style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
                {changeReport.summary.currentPagesWithIssues}
              </Text>
            </View>
            <DeltaBadge
              value={changeReport.summary.currentPagesWithIssues - changeReport.summary.previousPagesWithIssues}
              lowerIsBetter
              unit="pages"
            />
          </View>

          {changeReport.summary.excludedPreviousIssueCount > 0 && (
            <Text style={{ fontSize: 7.5, color: COLORS.zinc400, marginTop: 6 }}>
              {changeReport.summary.excludedPreviousIssueCount} previous finding
              {changeReport.summary.excludedPreviousIssueCount === 1 ? "" : "s"} excluded (page not
              successfully re-analyzed).
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function Page2({ data }: { data: SiteReportData }) {
  return (
    <Page size="A4" style={styles.page} wrap>
      <RunningHeader siteName={data.site.name} dateLabel={formatDateShort(data.generatedAt)} />
      <Text style={styles.h1}>Performance & Progress</Text>

      <SearchConsoleKpiSection searchConsole={data.searchConsole} />
      <SeoProgressSection data={data} />

      <RunningFooter />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// PAGE 3 — Priority Action Plan
// ---------------------------------------------------------------------------

function ActionPlanItem({ opportunity, pagesAnalyzed }: { opportunity: SeoOpportunity; pagesAnalyzed: number }) {
  const shown = opportunity.affectedPages.slice(0, MAX_ACTION_PLAN_URLS);
  const remaining = opportunity.affectedPages.length - shown.length;

  return (
    <View
      style={[styles.card, { marginTop: 14, borderLeftWidth: 3, borderLeftColor: PRIORITY_ACCENTS[opportunity.priority] }]}
      wrap={false}
    >
      <View style={[styles.row, { gap: 4, alignItems: "center" }]}>
        <PriorityBadge priority={opportunity.priority} />
        <CategoryBadge category={opportunity.category} />
      </View>
      <Text style={{ fontSize: 12, fontWeight: 700, marginTop: 8 }}>{opportunity.label}</Text>

      <Text style={[styles.eyebrowMuted, { marginTop: 11 }]}>Why it matters</Text>
      <Text style={{ fontSize: 9.5, color: COLORS.zinc700, marginTop: 3 }}>{opportunity.whyItMatters}</Text>

      <Text style={[styles.eyebrowMuted, { marginTop: 10 }]}>Scope</Text>
      <Text style={{ fontSize: 9.5, color: COLORS.zinc700, marginTop: 3 }}>
        {opportunity.affectedPages.length} of {pagesAnalyzed} pages
      </Text>

      <Text style={[styles.eyebrowMuted, { marginTop: 10 }]}>Recommended action</Text>
      <Text style={{ fontSize: 9.5, color: COLORS.primaryStrong, fontWeight: 700, marginTop: 3 }}>
        {opportunity.recommendedAction}
      </Text>

      {shown.length > 0 && (
        <View style={{ marginTop: 11, gap: 1.5, borderTopWidth: 0.5, borderTopColor: COLORS.zinc200, paddingTop: 6 }}>
          {shown.map((p) => (
            <Text key={p.url} style={{ fontSize: 7.5, color: COLORS.zinc400 }}>
              {p.url}
            </Text>
          ))}
          {remaining > 0 && (
            <Text style={{ fontSize: 7.5, color: COLORS.zinc400 }}>
              + {remaining} more affected page{remaining === 1 ? "" : "s"}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function ActionPlanSection({ health }: { health: SeoHealthReport | null }) {
  if (!health || health.opportunities.length === 0) {
    return (
      <Text style={{ fontSize: 9, color: COLORS.zinc500 }}>
        No opportunities were identified in the latest analysis.
      </Text>
    );
  }
  return (
    <View>
      {health.opportunities.map((opportunity) => (
        <ActionPlanItem
          key={opportunity.issueType}
          opportunity={opportunity}
          pagesAnalyzed={health.summary.pagesAnalyzed}
        />
      ))}
    </View>
  );
}

function NextStepsPanel({ health }: { health: SeoHealthReport | null }) {
  const top = (health?.opportunities ?? []).slice(0, MAX_RECOMMENDATIONS);
  if (top.length === 0) return null;

  return (
    <View style={[styles.panelTeal, { marginTop: 26 }]} wrap={false}>
      <Text style={styles.eyebrow}>Recommended Next Steps</Text>
      <View style={{ marginTop: 10, gap: 7 }}>
        {top.map((opportunity, i) => (
          <View key={opportunity.issueType} style={[styles.row, { gap: 6 }]}>
            <Text style={{ fontSize: 9, fontWeight: 700, color: COLORS.primaryStrong, width: 14 }}>{i + 1}.</Text>
            <Text style={{ fontSize: 9, color: COLORS.zinc800, flex: 1, lineHeight: 1.35 }}>
              <Text style={{ fontWeight: 700 }}>{opportunity.label}: </Text>
              {opportunity.recommendedAction}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Page3({ data }: { data: SiteReportData }) {
  return (
    <Page size="A4" style={styles.page} wrap>
      <RunningHeader siteName={data.site.name} dateLabel={formatDateShort(data.generatedAt)} />
      <Text style={styles.h1}>Priority Action Plan</Text>

      <View style={{ marginTop: 14 }}>
        <ActionPlanSection health={data.health} />
      </View>
      <NextStepsPanel health={data.health} />

      <RunningFooter />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// PAGE 4+ — Technical Appendix (visually secondary: smaller type, muted)
// ---------------------------------------------------------------------------

/** One issue type's full evidence, grouped rather than repeated per row —
 * a single header (label + priority/category/affected-count) followed by
 * every affected URL, replacing the old one-badge-and-label-per-row
 * layout that repeated the same label text for every single affected
 * page. No `wrap={false}` on the group as a whole: a group's URL list is
 * free to continue naturally onto the next page for a large finding (per
 * this redesign's pagination-safety requirement) — only the small header
 * block is kept together so a title is never separated from its own
 * priority/category/count line. */
type AppendixIssueGroup = {
  issueType: string;
  category: IssueCategory;
  priority: IssuePriority;
  label: string;
  urls: string[];
};

function AppendixIssueGroupCard({ group }: { group: AppendixIssueGroup }) {
  return (
    <View style={{ marginTop: 10 }}>
      <View wrap={false}>
        <Text style={{ fontSize: 8.5, fontWeight: 700, color: COLORS.zinc700 }}>{group.label}</Text>
        <Text style={{ fontSize: 7.5, color: COLORS.zinc500, marginTop: 1 }}>
          {PRIORITY_LABELS[group.priority]} · {CATEGORY_LABELS[group.category]} · {group.urls.length} affected
          page{group.urls.length === 1 ? "" : "s"}
        </Text>
      </View>
      <View style={{ marginTop: 3 }}>
        {group.urls.map((url) => (
          <Text key={url} style={{ fontSize: 7, color: COLORS.zinc400, marginTop: 1.5 }} wrap={false}>
            – {url}
          </Text>
        ))}
      </View>
    </View>
  );
}

function AppendixIssueGroupList({
  title,
  groups,
  emptyText,
}: {
  title: string;
  groups: AppendixIssueGroup[];
  emptyText: string;
}) {
  const totalUrls = groups.reduce((sum, group) => sum + group.urls.length, 0);
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ fontSize: 8, fontWeight: 700, color: COLORS.zinc600 }}>
        {title} ({totalUrls})
      </Text>
      {groups.length === 0 ? (
        <Text style={{ fontSize: 7.5, color: COLORS.zinc400, marginTop: 2 }}>{emptyText}</Text>
      ) : (
        groups.map((group) => <AppendixIssueGroupCard key={group.issueType} group={group} />)
      )}
    </View>
  );
}

/** `health.opportunities` is already grouped one-per-issue-type — this
 * just reshapes it into `AppendixIssueGroup`'s flatter, appendix-only
 * shape (a plain array of URLs rather than `{url, message}` objects). No
 * new data or regrouping: same opportunities the Priority Action Plan
 * already shows, with every affected URL instead of that page's capped
 * representative sample. */
function opportunitiesToAppendixGroups(opportunities: SeoOpportunity[]): AppendixIssueGroup[] {
  return opportunities.map((opportunity) => ({
    issueType: opportunity.issueType,
    category: opportunity.category,
    priority: opportunity.priority,
    label: opportunity.label,
    urls: opportunity.affectedPages.map((page) => page.url),
  }));
}

/** `changeReport.resolved`/`newIssues`/`remaining` are already flat
 * per-URL `ChangedIssue` rows (potentially spanning several issue types)
 * — grouped here by issue type for the same repetitive-row-per-finding
 * fix as `opportunitiesToAppendixGroups`, just starting from a flat list
 * instead of an already-grouped one. Preserves each group's first-seen
 * order (matching `changeReport`'s own ordering) rather than re-sorting. */
function groupChangedIssues(issues: ChangedIssue[]): AppendixIssueGroup[] {
  const groups: AppendixIssueGroup[] = [];
  const groupByType = new Map<string, AppendixIssueGroup>();
  for (const issue of issues) {
    const existing = groupByType.get(issue.issueType);
    if (existing) {
      existing.urls.push(issue.url);
      continue;
    }
    const group: AppendixIssueGroup = {
      issueType: issue.issueType,
      category: issue.category,
      priority: issue.priority,
      label: issue.label,
      urls: [issue.url],
    };
    groupByType.set(issue.issueType, group);
    groups.push(group);
  }
  return groups;
}

/** "Remaining" findings are, by definition, already fully enumerated in
 * "Current Findings" above (every current finding is either new or
 * remaining) — listing them again here just duplicated the same URLs a
 * second time, which was needlessly pushing the appendix onto an extra
 * page. A concise count instead of a second full listing; Resolved/New
 * keep their full per-URL detail since those pages don't appear in
 * Current Findings (Resolved no longer has a current finding at all;
 * New already does appear there, but grouped under its current issue
 * type rather than singled out as "new"). */
function AppendixRemainingSummary({ count }: { count: number }) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ fontSize: 8, fontWeight: 700, color: COLORS.zinc600 }}>Remaining ({count})</Text>
      <Text style={{ fontSize: 7.5, color: COLORS.zinc500, marginTop: 2 }}>
        {count === 0
          ? "No issues remained unchanged since the previous analysis."
          : `${count} finding${count === 1 ? "" : "s"} remain${count === 1 ? "s" : ""} from the previous analysis. See Current Findings above for detail.`}
      </Text>
    </View>
  );
}

function Page4({ data }: { data: SiteReportData }) {
  const { health, changeReport } = data;
  if (!health) return null;

  const currentFindingGroups = opportunitiesToAppendixGroups(health.opportunities);
  const hasExcludedSeedArtifacts =
    health.summary.excludedSeedArtifactCount > 0 ||
    (changeReport?.status === "compared" && changeReport.summary.excludedSeedArtifactCount > 0);

  return (
    <Page size="A4" style={styles.page} wrap>
      <RunningHeader siteName={data.site.name} dateLabel={formatDateShort(data.generatedAt)} />
      <Text style={styles.h2Muted}>Technical Appendix</Text>
      <Text style={{ fontSize: 7.5, color: COLORS.zinc400, marginBottom: 4 }}>
        Detailed findings and affected pages from the latest analysis, provided for implementation
        reference.
      </Text>

      <AppendixIssueGroupList
        title="Current Findings"
        groups={currentFindingGroups}
        emptyText="No findings in the latest analysis."
      />

      {changeReport?.status === "compared" && (
        <View style={{ marginTop: 12 }}>
          <Text style={{ fontSize: 8, fontWeight: 700, color: COLORS.zinc600 }}>
            Changes Since Last Analysis — Detail
          </Text>
          <AppendixIssueGroupList
            title="Resolved"
            groups={groupChangedIssues(changeReport.resolved)}
            emptyText="No issues were resolved since the previous analysis."
          />
          <AppendixIssueGroupList
            title="New"
            groups={groupChangedIssues(changeReport.newIssues)}
            emptyText="No new issues were introduced since the previous analysis."
          />
          <AppendixRemainingSummary count={changeReport.summary.remainingCount} />
        </View>
      )}

      {hasExcludedSeedArtifacts && (
        <View style={{ marginTop: 12, borderTopWidth: 0.5, borderTopColor: COLORS.zinc200, paddingTop: 6, gap: 2 }}>
          {health.summary.excludedSeedArtifactCount > 0 && (
            <Text style={{ fontSize: 7, color: COLORS.zinc400 }}>
              Note: {health.summary.excludedSeedArtifactCount} redirect/canonical finding
              {health.summary.excludedSeedArtifactCount === 1 ? "" : "s"} on the registered entry URL{" "}
              {health.summary.excludedSeedArtifactCount === 1 ? "was" : "were"} excluded from the SEO
              Health Summary and Priority Action Plan totals above — see the Registered/Effective URL
              note on page 1.
            </Text>
          )}
          {changeReport?.status === "compared" && changeReport.summary.excludedSeedArtifactCount > 0 && (
            <Text style={{ fontSize: 7, color: COLORS.zinc400 }}>
              Note: {changeReport.summary.excludedSeedArtifactCount} redirect/canonical finding
              {changeReport.summary.excludedSeedArtifactCount === 1 ? "" : "s"} on the registered entry
              URL {changeReport.summary.excludedSeedArtifactCount === 1 ? "was" : "were"} excluded from
              the SEO Progress comparison on page 2 for the same reason.
            </Text>
          )}
        </View>
      )}

      <RunningFooter />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/**
 * The full downloadable SEO report — every number/label/text here comes
 * straight from `SiteReportData`, itself assembled by
 * `assembleSiteReportData` using the exact same domain functions
 * (buildSeoHealthReport/buildSeoChangeReport/buildMarkoInsights/narrative.ts,
 * the registered/effective URL helpers) the live Site Detail page uses. No
 * calculation happens in this file — only formatting/layout of data that
 * already exists.
 *
 * Fixed four-page structure (per the premium client-report redesign):
 *  1. Executive Overview — the commercial centerpiece, useful standalone.
 *  2. Performance & Progress — Search Console + resolved/new/remaining.
 *  3. Priority Action Plan — every opportunity as a structured action item.
 *  4+. Technical Appendix — full raw findings, visually secondary.
 */
export function SeoReportDocument({ data }: { data: SiteReportData }) {
  return (
    <Document title={`MARKO SEO Report - ${data.site.name}`} author="MARKO">
      <Page1 data={data} />
      <Page2 data={data} />
      <Page3 data={data} />
      {data.health && <Page4 data={data} />}
    </Document>
  );
}
