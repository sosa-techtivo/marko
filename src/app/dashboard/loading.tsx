import { SitesGridSkeleton } from "@/components/SitesGridSkeleton";

/**
 * Next.js route-level loading UI for /dashboard — shown immediately on
 * navigation (e.g. "Back to sites") while the sites list's own data
 * fetching resolves. `dashboard/layout.tsx` (header/shell) is unaffected:
 * this only replaces the page content wrapped in `<main>`.
 */
export default function DashboardLoading() {
  return <SitesGridSkeleton />;
}
