import { StyleSheet } from "@react-pdf/renderer";

/**
 * Colors mirrored from src/app/globals.css (MARKO primary) and Tailwind's
 * standard zinc/red/amber/green palettes (the same ones the app's own
 * badges/cards already use) — so the PDF reads as the same product, not a
 * separately-designed document. Extended with a few extra tints/shades
 * beyond what the live dashboard needs, for the report's own panel/KPI-card
 * treatment (banded hero, tinted panels, semantic bars).
 */
export const COLORS = {
  primary: "#339595",
  primaryHover: "#2a7a7a",
  primaryStrong: "#226262",
  primaryTint: "#e8f4f3",
  primaryTintStrong: "#d2e9e8",
  zinc50: "#fafafa",
  zinc100: "#f4f4f5",
  zinc200: "#e4e4e7",
  zinc300: "#d4d4d8",
  zinc400: "#a1a1aa",
  zinc500: "#71717a",
  zinc600: "#52525b",
  zinc700: "#3f3f46",
  zinc800: "#27272a",
  zinc900: "#18181b",
  white: "#ffffff",
  red50: "#fef2f2",
  red200: "#fecaca",
  red500: "#ef4444",
  red700: "#b91c1c",
  amber50: "#fffbeb",
  amber200: "#fde68a",
  amber500: "#f59e0b",
  amber800: "#92400e",
  green50: "#f0fdf4",
  green200: "#bbf7d0",
  green500: "#22c55e",
  green700: "#15803d",
  blue50: "#eff6ff",
  blue200: "#bfdbfe",
  blue700: "#1d4ed8",
} as const;

export const PRIORITY_COLORS: Record<"high" | "medium" | "low", { bg: string; border: string; text: string }> = {
  high: { bg: COLORS.red50, border: COLORS.red200, text: COLORS.red700 },
  medium: { bg: COLORS.amber50, border: COLORS.amber200, text: COLORS.amber800 },
  low: { bg: COLORS.zinc100, border: COLORS.zinc300, text: COLORS.zinc600 },
};

/** Left-edge accent bar colors for priority-badged cards — same hues as
 * PRIORITY_COLORS' text tone, used as a solid strip rather than text
 * color so priority reads at a glance without depending on badge text. */
export const PRIORITY_ACCENTS: Record<"high" | "medium" | "low", string> = {
  high: COLORS.red500,
  medium: COLORS.amber500,
  low: COLORS.zinc300,
};

export const STATUS_COLORS: Record<"healthy" | "needs_attention" | "critical" | "not_analyzed", { bg: string; border: string; text: string }> = {
  healthy: { bg: COLORS.green50, border: COLORS.green200, text: COLORS.green700 },
  needs_attention: { bg: COLORS.amber50, border: COLORS.amber200, text: COLORS.amber800 },
  critical: { bg: COLORS.red50, border: COLORS.red200, text: COLORS.red700 },
  not_analyzed: { bg: COLORS.zinc100, border: COLORS.zinc300, text: COLORS.zinc600 },
};

export const STATUS_LABELS: Record<"healthy" | "needs_attention" | "critical" | "not_analyzed", string> = {
  healthy: "Healthy",
  needs_attention: "Needs attention",
  critical: "Critical",
  not_analyzed: "Not analyzed",
};

export const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 44,
    paddingHorizontal: 40,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: COLORS.zinc900,
  },
  /** Compact running header used on every page except the cover — the
   * cover carries its own full-width hero band instead. */
  runningHeader: {
    position: "absolute",
    top: 22,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 7.5,
    color: COLORS.zinc400,
    borderBottomWidth: 0.75,
    borderBottomColor: COLORS.zinc200,
    paddingBottom: 6,
  },
  runningHeaderBrand: { fontSize: 8, fontWeight: 700, color: COLORS.primaryStrong, letterSpacing: 0.4 },
  runningFooter: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 7.5,
    color: COLORS.zinc400,
    borderTopWidth: 0.75,
    borderTopColor: COLORS.zinc200,
    paddingTop: 6,
  },

  /** Full-bleed colored band at the top of the cover page — bleeds past
   * the page's own padding via matching negative margins, so it reads as
   * a deliberate banner rather than a bordered box floating in whitespace. */
  heroBand: {
    marginTop: -56,
    marginHorizontal: -40,
    paddingTop: 26,
    paddingHorizontal: 40,
    paddingBottom: 22,
    // Very light teal/aqua tint (not the dark primaryStrong band this
    // replaced) — chosen so the Techtivo logo asset (dark wordmark +
    // teal mark) keeps strong contrast against the header instead of
    // blending into a dark background. Text tokens below were flipped
    // from white-on-dark to dark-on-light to match.
    backgroundColor: COLORS.primaryTint,
  },
  heroBrandRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  heroWordmark: { fontSize: 13, fontWeight: 700, color: COLORS.primaryStrong, letterSpacing: 0.5 },
  heroEyebrow: {
    fontSize: 8,
    fontWeight: 700,
    color: COLORS.primaryStrong,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginTop: 16,
  },
  heroTitle: { fontSize: 24, fontWeight: 700, color: COLORS.zinc900, marginTop: 4 },
  heroMeta: { fontSize: 8.5, color: COLORS.zinc600, marginTop: 8 },
  heroHeadline: {
    fontSize: 13.5,
    fontWeight: 700,
    color: COLORS.zinc900,
    marginTop: 20,
    lineHeight: 1.35,
  },

  h1: { fontSize: 20, fontWeight: 700, color: COLORS.zinc900 },
  h2: {
    fontSize: 13,
    fontWeight: 700,
    color: COLORS.primaryStrong,
    paddingBottom: 5,
    marginBottom: 10,
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.primary,
  },
  /** Muted section title for the Technical Appendix — deliberately not the
   * teal `h2` treatment, so appendix pages read as visually secondary to
   * the client-facing report ahead of them. */
  h2Muted: {
    fontSize: 11,
    fontWeight: 700,
    color: COLORS.zinc500,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingBottom: 5,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.zinc300,
  },
  eyebrow: {
    fontSize: 7,
    fontWeight: 700,
    color: COLORS.primaryStrong,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  eyebrowMuted: {
    fontSize: 7,
    fontWeight: 700,
    color: COLORS.zinc500,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  sectionSpacing: { marginTop: 22 },
  row: { flexDirection: "row" },

  card: {
    borderWidth: 1,
    borderColor: COLORS.zinc200,
    borderRadius: 5,
    padding: 10,
    backgroundColor: COLORS.white,
  },
  /** Tinted, borderless panel — the report's primary "this matters" surface
   * (executive summary, MARKO Recommends, Recommended Next Steps) — used
   * instead of another thin-bordered white box so these read as distinct,
   * purposeful surfaces rather than blending into the page. */
  panelTeal: {
    backgroundColor: COLORS.primaryTint,
    borderRadius: 8,
    padding: 15,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
  },
  panelAmber: {
    backgroundColor: COLORS.amber50,
    borderRadius: 8,
    padding: 15,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.amber500,
  },

  badge: {
    borderWidth: 1,
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
    fontSize: 7,
    fontWeight: 700,
  },
  muted: { color: COLORS.zinc500 },

  /** KPI card — a colored top accent + large value + small caps label,
   * standing in for the old bare `StatBlock` number-and-caption pair. */
  kpiCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.zinc200,
    borderTopWidth: 3,
    borderTopColor: COLORS.primary,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  kpiValue: { fontSize: 19, fontWeight: 700, color: COLORS.zinc900 },
  kpiLabel: {
    fontSize: 7,
    color: COLORS.zinc500,
    marginTop: 3,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  kpiDelta: { fontSize: 7, marginTop: 3, fontWeight: 700 },

  statLabel: { fontSize: 7, color: COLORS.zinc500, marginTop: 2 },
  statValue: { fontSize: 16, fontWeight: 700, color: COLORS.zinc900 },
});
