# MARKO — Project Status

## Current MVP objective

Per `CLAUDE.md`, the confirmed MVP is an SEO analysis/reporting product for
real websites, demonstrable around September 10–15, 2026. This checkpoint
covers the SaaS account/auth foundation plus **Milestone 2: a first
end-to-end SEO crawl vertical slice** (manual crawl → deterministic
findings → persisted history → dashboard summary). Search Console, AI,
scoring, and reporting are still not implemented.

## Completed functionality

### Account / tenant foundation
- Next.js (App Router) + TypeScript + Tailwind CSS project scaffold
- Supabase Auth integration using `@supabase/ssr` (browser client, server
  client, middleware session refresh) following the current recommended
  cookie-based pattern
- Email/password login page with sign-up (`/login`)
- Auth callback route for email confirmation (`/auth/callback`) and sign-out
  route (`/auth/signout`)
- Protected `/dashboard` route: server-side session check redirects
  unauthenticated users to `/login`
- Minimal authenticated app shell: top bar with org name (once one exists),
  user email, sign out
- Multi-tenant database foundation (`supabase/migrations/0001_init.sql`,
  privileges in `0002_grant_authenticated_table_privileges.sql`):
  - `organizations` — represents a client/business account; not
    auto-created, never tied to auth signup
  - `organization_memberships` (many-to-many, a user may belong to multiple
    organizations; no role/permission column — membership existence is all
    that's needed for tenant isolation)
  - `sites`
  - Row Level Security on all tables, scoped to the caller's memberships,
    plus the explicit `authenticated` table grants PostgREST requires
    (this project has "Automatically expose new tables" disabled, so a
    plain SQL migration grants nothing by default)
  - `create_organization(org_name)` — a `security definer` function and the
    *only* way to create an organization; atomically inserts the
    organization and the caller's membership row
- Minimal organization creation flow: on `/dashboard`, a user with no
  organization sees a "Create your organization" form (name only), calling
  `create_organization` via RPC
- Minimal site creation flow: `/dashboard/sites/new` form (name + URL) that
  inserts into `sites` scoped to the user's organization, available once an
  organization exists
- Dashboard site list reads real data from Postgres, links each site to its
  detail page; shows a genuine empty state (no mock/fake data) when no
  sites exist yet

### SEO crawl (Milestone 2, `supabase/migrations/0003_seo_crawl.sql`)
- `/dashboard/sites/[siteId]` — site detail page with a manual **"Run SEO
  analysis"** button, the latest crawl's status/timestamp/summary, and a
  per-page table of results and detected issues
- Crawl scope, deliberately conservative: the site's registered start URL
  plus up to **4** same-site internal links found *on that start page*
  (single hop, no recursion into secondary pages) — **5 pages per run,
  max**. External domains and non-HTML assets (images, PDFs, CSS/JS, etc.)
  are never followed. Each page fetch has a 10s timeout.
  (`src/lib/crawler/runCrawl.ts`, `MAX_PAGES_PER_CRAWL`)
- No new dependency: HTML extraction (title, meta description, canonical,
  H1, internal links, meta robots) is done with small, focused regexes in
  `src/lib/crawler/html.ts` rather than a DOM-parsing library
- Deterministic issue detection only (no AI/LLM calls) — `http_error`,
  `missing_title`, `missing_meta_description`, `missing_h1`,
  `non_indexable`, `invalid_canonical` — each with a fixed severity
  (`critical`/`warning`) and a plain-language message
  (`src/lib/crawler/analyze.ts`)
- Runs synchronously inside one Server Action request (`runSeoAnalysis` in
  `src/app/dashboard/sites/[siteId]/actions.ts`) — no queue, no background
  job, no scheduling
- Every run is persisted as history in `crawl_runs` (status/timing/error) +
  `crawl_pages` (raw page data) + `crawl_issues` (findings); previous runs
  are never overwritten, the dashboard shows only the *latest* one
- Crawl failure (unreachable start URL, invalid URL, or a save failure) is
  recorded as `crawl_runs.status = 'failed'` with a message, and shown
  visibly on the site page — never silent, never fabricated data

## Current architecture

- Generic account/tenant infrastructure (`organizations`,
  `organization_memberships`, `sites`, auth) is kept independent of any
  SEO-specific domain logic, so future specialist agents can share it.
- SEO crawl logic lives entirely under `src/lib/crawler/` (fetch, HTML
  extraction, and issue analysis are separate, dependency-free, mostly pure
  modules) and is orchestrated only from
  `src/app/dashboard/sites/[siteId]/actions.ts` — it does not reach into
  tenant/auth internals beyond the existing `requireUserAndOrganization()`
  helper.
- Auth/session logic lives in `src/lib/supabase/*`; tenant-resolution logic
  (current organization for the signed-in user) lives in
  `src/lib/organizations.ts`.
- No org-switcher UI exists yet — the app currently operates on the user's
  first (earliest-created) organization membership. The schema already
  supports multiple memberships per user.

## Known limitations

- No invitations or team management — an organization has exactly one
  member (its creator) until that's built.
- No organization settings/editing.
- No password reset / magic-link flow.
- No org switcher — a user with multiple memberships will only see their
  first organization in the UI.
- No site editing/deletion.
- `sites` has no per-row UPDATE/DELETE RLS policies yet (not needed until
  those flows exist).
- Crawl trigger is a synchronous request/response — a very slow target site
  can make "Run SEO analysis" take up to roughly 50s (5 pages × 10s
  timeout, worst case). Acceptable for a manual, local-first MVP action;
  would need a background job for a serverless production deployment with
  tighter request timeouts — out of scope per "no scheduled/background
  crawling."
- No `robots.txt` fetch/parse: "indexability" is derived only from HTTP
  status and on-page `<meta name="robots">` / `X-Robots-Tag`.
- No SSRF hardening on the crawl target (e.g. blocking private/internal IP
  ranges) — the target is always a URL the org itself already registered
  via the existing "Add site" flow, same trust boundary as today.
- Crawl history has no pruning/retention policy yet — every run is kept
  indefinitely.

## Deferred scope (explicitly out of this checkpoint)

Google Search Console/GA4/GBP integration, GEO monitoring, AI-assisted
analysis, SEO health scoring, structured-data validation, historical
trend/progress reporting, ticketing, Developer Agent, auto-fixes, and any
mock/fake analytics. See `CLAUDE.md` for the full list.

## Next logical milestone

Use the persisted `crawl_pages`/`crawl_issues` data as the input to a
plain-language findings/opportunities summary (still deterministic, no AI)
before introducing Google Search Console data.
