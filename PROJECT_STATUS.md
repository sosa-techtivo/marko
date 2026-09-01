# MARKO — Project Status

## Current MVP objective

Per `CLAUDE.md`, the confirmed MVP is an SEO analysis/reporting product for
real websites, demonstrable around September 10–15, 2026. This checkpoint
covers the SaaS account/auth foundation, **Milestone 2: a first end-to-end
SEO crawl vertical slice** (manual crawl → deterministic findings →
persisted history → dashboard summary), and **Milestone 3: SEO Health &
Opportunities** (deterministic category/priority classification →
grouped, prioritized opportunities → plain-language health summary).
Search Console and historical trend reporting are still not implemented.

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
- SSRF hardening on all crawl fetches (`src/lib/crawler/ssrfGuard.ts`,
  `src/lib/crawler/fetchPage.ts`): only http/https, `localhost`/IP-literal
  and DNS-resolved private/loopback/link-local/multicast/reserved
  destinations are rejected before connecting, and every redirect hop is
  re-validated the same way (manual redirect handling, max 3 hops, one
  timeout covering the whole chain). Non-HTML responses are never parsed as
  HTML.

### SEO Health & Opportunities (Milestone 3)
- `/dashboard/sites/[siteId]` now renders, above the existing per-page
  table, an **SEO Health Summary** (pages analyzed, pages with issues,
  high-priority issues, total opportunities) and a **Top Opportunities**
  list — derived entirely from the latest completed crawl's already-stored
  `crawl_pages`/`crawl_issues` rows, no schema change and no new query
  beyond widening one existing `select`
  (`src/lib/reporting/seoHealthReport.ts`)
- Every issue type is classified into a fixed **category**
  (Technical/Metadata/Indexability/Structure) and a fixed **priority**
  (High/Medium/Low), defined as an explicit, documented lookup table in
  `src/lib/reporting/issueTaxonomy.ts` — no AI, no weighted/arbitrary
  scoring, no 0–100 rating:
  | issue_type | category | priority |
  |---|---|---|
  | `http_error` | Technical | High |
  | `non_indexable` | Indexability | High |
  | `missing_title` | Metadata | High |
  | `missing_meta_description` | Metadata | Medium |
  | `invalid_canonical` | Indexability | Medium |
  | `missing_h1` | Structure | Low |
- Opportunities are grouped by issue type across pages (one card per issue
  type, not one card per page × issue), sorted by priority then by number
  of affected pages, and each card states what was detected, the affected
  page(s), why it matters, and what to review
- When a crawl finds zero issues, the report states plainly that no
  critical SEO issues were detected and lists only the positive signals
  the crawl data actually supports (e.g. "every analyzed page has a title
  tag" is only shown if literally true of every page in that run) — never
  a score, never "perfect SEO," and explicitly scoped to what that crawl
  measured

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
- The health/opportunities report (`src/lib/reporting/`) is a pure,
  dependency-free layer on top of the persisted crawl data — no new
  tables, no new queries beyond widening the existing `crawl_pages`
  `select`. It is deliberately separate from `src/lib/crawler/` (raw
  fetch/detect) so the classification rules can evolve without touching
  crawl logic.

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
  can make "Run SEO analysis" take up to roughly 40s (5 pages × 8s
  per-page timeout, worst case), within the route's `maxDuration = 60`.
  Acceptable for a manual, local-first MVP action; would need a background
  job for a serverless production deployment with tighter platform
  request timeouts — out of scope per "no scheduled/background crawling."
- No `robots.txt` fetch/parse: "indexability" is derived only from HTTP
  status and on-page `<meta name="robots">` / `X-Robots-Tag`.
- Crawl history has no pruning/retention policy yet — every run is kept
  indefinitely.
- The health report reflects only the single latest completed crawl — no
  historical trend/progress-over-time comparison yet (explicitly deferred
  to the next milestone).
- Opportunities are grouped by `issue_type` only; if the same issue type
  has meaningfully different messages across pages (e.g. different HTTP
  status codes for `http_error`), the group still shows one shared
  "why it matters"/"what to review" with each page's own specific message
  listed underneath — not split into separate cards per message variant.

## Deferred scope (explicitly out of this checkpoint)

Google Search Console/GA4/GBP integration, GEO monitoring, AI-assisted
analysis, 0–100 SEO health scoring, structured-data validation, historical
trend/progress reporting, ticketing, Developer Agent, auto-fixes, and any
mock/fake analytics. See `CLAUDE.md` for the full list.

## Next logical milestone

Historical tracking: preserve/compare health summaries across runs to show
whether SEO health is improving over time, before introducing Google Search
Console data.
