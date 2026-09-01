# MARKO — Project Status

## Current MVP objective

Per `CLAUDE.md`, the confirmed MVP is an SEO analysis/reporting product for
real websites, demonstrable around September 10–15, 2026. This checkpoint
covers the SaaS account/auth foundation, **Milestone 2: a first end-to-end
SEO crawl vertical slice** (manual crawl → deterministic findings →
persisted history → dashboard summary), **Milestone 3: SEO Health &
Opportunities** (deterministic category/priority classification →
grouped, prioritized opportunities → plain-language health summary), and
**Milestone 4: Historical SEO Changes** (deterministic latest-vs-previous
comparison → resolved/new/remaining issues). Search Console is still not
implemented.

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

### Historical SEO Changes (Milestone 4)
- `/dashboard/sites/[siteId]` now renders a **Changes Since Last Analysis**
  section comparing the two most recent *completed* crawl runs (not
  necessarily the same as the overall latest run shown at the top of the
  page, which can be `running`/`failed`) — derived entirely from existing
  `crawl_runs`/`crawl_pages`/`crawl_issues` rows, no schema change
  (`src/lib/reporting/seoChangeReport.ts`)
- Each `(page URL, issue_type)` pair is classified as **Resolved** (in the
  previous run, absent now), **New** (absent previously, present now), or
  **Remaining** (in both) — reusing `issueTaxonomy.ts` for each item's
  category/priority rather than redefining it
- Resolved is deliberately conservative: the crawler analyzes at most 5
  pages and which pages get crawled can change run to run (link discovery
  on the start page isn't guaranteed stable), so a previous issue is only
  ever counted Resolved if its page URL was *also successfully
  re-analyzed* in the current run (present in the current run's pages,
  2xx status, no fetch error). If the page wasn't re-crawled, or was
  re-crawled but failed to fetch, that previous issue is excluded from
  the comparison entirely (never silently counted as fixed) and the
  excluded count is surfaced as a factual note
- The Change Summary is counts only — "N issues resolved · N new issues"
  or "No SEO issue changes detected since the previous analysis" — the UI
  never labels the result an "improvement" or invents a percentage/score
- First completed crawl for a site: the section explicitly states no
  previous analysis is available yet, with no empty Resolved/New/Remaining
  sections shown
- The comparison always states which two runs (by timestamp) are being
  compared and that results reflect only the pages those two crawls
  actually measured

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
- The health/opportunities/change reports (`src/lib/reporting/`) are pure,
  dependency-free layers on top of the persisted crawl data — no new
  tables, no new queries beyond widening the existing `crawl_pages`
  `select` (Milestone 3) and two additional `select`s scoped to the two
  most recent completed run IDs (Milestone 4). Deliberately separate from
  `src/lib/crawler/` (raw fetch/detect) so classification/comparison rules
  can evolve without touching crawl logic. `issueTaxonomy.ts` is the one
  place category/priority are defined; both the health report and the
  change report import it rather than redefining anything.

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
- Opportunities are grouped by `issue_type` only; if the same issue type
  has meaningfully different messages across pages (e.g. different HTTP
  status codes for `http_error`), the group still shows one shared
  "why it matters"/"what to review" with each page's own specific message
  listed underneath — not split into separate cards per message variant.
- The Changes Since Last Analysis comparison only ever looks at the two
  most recent *completed* runs — it does not show a longer trend/history
  across more than two runs yet (that would be a further milestone, not
  requested here).
- A previous issue on a page that wasn't successfully re-crawled this run
  is excluded from the comparison rather than shown as "unknown"/"stale"
  in its own bucket — surfaced only as a count in a short note, not as
  individual line items. This keeps the UI to the three sections actually
  requested (Resolved/New/Remaining) without inventing a fourth.

## Deferred scope (explicitly out of this checkpoint)

Google Search Console/GA4/GBP integration, GEO monitoring, AI-assisted
analysis, 0–100 SEO health scoring, structured-data validation, multi-run
(more than two) trend reporting, ticketing, Developer Agent, auto-fixes,
and any mock/fake analytics. See `CLAUDE.md` for the full list.

## Next logical milestone

Google Search Console integration: authorize per-site access via OAuth and
use performance data (clicks/impressions/CTR/position) to enrich
prioritization and reporting, per CLAUDE.md's Search Console section.
