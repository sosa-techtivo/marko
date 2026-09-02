import { redirect } from "next/navigation";

/**
 * Add Site is now a modal on /dashboard (see AddSiteButton). This route is
 * kept only as a compatibility fallback for old links/bookmarks.
 */
export default function NewSitePage() {
  redirect("/dashboard?addSite=1");
}
