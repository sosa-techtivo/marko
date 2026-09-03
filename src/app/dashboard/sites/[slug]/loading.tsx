import { SiteDetailSkeleton } from "@/components/seoReport/SiteDetailSkeleton";

/**
 * Next.js route-level loading UI for /dashboard/sites/[slug] — shown
 * immediately on navigation (a site card, "View report", or any other
 * link into this route) while the page's own data fetching resolves.
 * `dashboard/layout.tsx` (header/shell) is unaffected: this only replaces
 * the page content wrapped in `<main>`.
 */
export default function SiteDetailLoading() {
  return <SiteDetailSkeleton />;
}
