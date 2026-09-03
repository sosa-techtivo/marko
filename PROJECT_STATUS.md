# MARKO — Project Status

## MVP status

**AGREED PHASE 1 SEO MVP REQUIREMENTS: MET.**

Every capability named in `CLAUDE.md`'s Confirmed MVP Scope — multi-tenant
account foundation, site onboarding, website crawl, technical/on-page SEO
diagnostics, SEO health & prioritized opportunities, MARKO Insights,
historical analysis/before-after changes/progress over time, Search Console
connection with a real performance snapshot, and client-facing
reporting — is implemented, deterministic (no AI/LLM in the analysis
pipeline, verified), and demonstrated end-to-end against real production
sites (Techtivo, LendingPoint.com) with real persisted data, not mocked or
fabricated.

This verdict followed a dedicated final requirements audit that classified
every named requirement individually (DONE/PARTIAL/DEFERRED/FUTURE/NOT
IMPLEMENTED) against `CLAUDE.md`'s own text — not against the longer-term
MARKO/AI-CMO vision, which was never part of this MVP's agreed scope. The
handful of PARTIAL/NOT IMPLEMENTED items found (sitemap.xml crawling, Open
Graph/social metadata, full H2–H6 heading-hierarchy validation,
internal-linking-structure analysis beyond a raw count, Search Console
per-query/per-page dimensions, Search-Console-informed prioritization, and
site name/URL field editing) are real, bounded gaps against `CLAUDE.md`'s
text, each independently confirmed absent in the codebase — none of them
was ever part of the committed MVP, and none blocks demonstrating the core
product loop: Website → Analysis → Findings → Opportunities →
Recommendations → Reporting → Measurable Progress. See "Known limitations"
and "Deferred scope" below for the complete, itemized list.

## Current MVP objective

Per `CLAUDE.md`, the confirmed MVP is an SEO analysis/reporting product for
real websites, demonstrable around September 10–15, 2026. This checkpoint
covers the SaaS account/auth foundation, **Milestone 2: a first end-to-end
SEO crawl vertical slice** (manual crawl → deterministic findings →
persisted history → dashboard summary), **Milestone 3: SEO Health &
Opportunities** (deterministic category/priority classification →
grouped, prioritized opportunities → plain-language health summary), and
**Milestone 4: Historical SEO Changes** (deterministic latest-vs-previous
comparison → resolved/new/remaining issues), **Milestone 5: Expanded
Deterministic SEO Rules** (9 additional page-level and cross-page checks —
title/meta length and duplicates, multiple H1s, missing/unexpectedly-shared
canonicals), a **UI/UX Branding Foundation** pass (Techtivo/MARKO visual
identity — logo, color, typography, login/header shell), **Signup
Onboarding** (organization name captured at signup, auto-created after
email verification), **Milestone 5b: Canonical Chains + Analyzer Test
Coverage** (one additional cross-page check, plus the project's first
automated tests), and **Milestone 5c: Image Alt & Structured Data Checks**
(the two remaining on-page areas from `CLAUDE.md`'s MVP scope — image alt
coverage and JSON-LD parseability), and **Milestone 6: robots.txt Blocking
Detection + Redirect Transparency** (the two REQUIRED gaps from an MVP
coverage audit — a page disallowed by robots.txt, and a page reachable only
via redirect, are both now detected and reported). Search Console is
implemented as a connection/property/snapshot foundation but does not yet
enrich SEO prioritization.

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
  plus up to **19** same-site internal links found *on that start page*
  (single hop, no recursion into secondary pages) — **20 pages per run,
  max**. External domains and non-HTML assets (images, PDFs, CSS/JS, etc.)
  are never followed. Each page fetch has an 8s timeout; additional pages
  (beyond the seed) are fetched in small concurrent batches of 5 so the
  worst-case total crawl time (~40s) stays the same as the original 5-page
  sequential crawl despite the larger page cap.
  (`src/lib/crawler/runCrawl.ts`, `MAX_PAGES_PER_CRAWL`, `FETCH_CONCURRENCY`)
- No new dependency: HTML extraction (title, meta description, canonical,
  H1, internal links, meta robots) is done with small, focused regexes in
  `src/lib/crawler/html.ts` rather than a DOM-parsing library
- Deterministic issue detection only (no AI/LLM calls) — `http_error`,
  `missing_title`, `missing_meta_description`, `missing_h1`,
  `non_indexable`, `invalid_canonical`, plus 9 more added in Milestone 5 —
  each with a fixed severity (`critical`/`warning`) and a plain-language
  message (`src/lib/crawler/analyze.ts`)
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

  (extended further in Milestone 5 — see that section below)
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

### Expanded Deterministic SEO Rules (Milestone 5, `supabase/migrations/0004_seo_rules_expansion.sql`)
- 9 new deterministic issue types, all still no-AI/rule-based, extending
  (not replacing) the 6 from Milestone 2:
  | issue_type | category | priority | check |
  |---|---|---|---|
  | `title_too_short` | Metadata | Medium | title present but < 30 chars |
  | `title_too_long` | Metadata | Medium | title present but > 60 chars |
  | `duplicate_title` | Metadata | Medium | 2+ crawled pages share the same normalized title (cross-page) |
  | `meta_description_too_short` | Metadata | Low | meta description present but < 50 chars |
  | `meta_description_too_long` | Metadata | Low | meta description present but > 160 chars |
  | `duplicate_meta_description` | Metadata | Medium | 2+ crawled pages share the same normalized meta description (cross-page) |
  | `multiple_h1` | Structure | Medium | page has more than one `<h1>` element |
  | `missing_canonical` | Indexability | Low | page has no canonical tag at all (distinct from `invalid_canonical`, which covers empty/unparsable/cross-domain) |
  | `duplicate_canonical` | Indexability | Medium | 2+ *other*, non-self-referencing crawled pages declare the same valid canonical target (cross-page; `duplicate_canonical`'s priority isn't from an explicit spec — inferred as the same tier as `invalid_canonical`) |
- Title/meta description length thresholds are conventional, deterministic,
  and centralized as exported constants in `src/lib/crawler/analyze.ts`
  (`TITLE_MIN_LENGTH = 30`, `TITLE_MAX_LENGTH = 60`,
  `META_DESCRIPTION_MIN_LENGTH = 50`, `META_DESCRIPTION_MAX_LENGTH = 160`),
  reused by `issueTaxonomy.ts` for the recommendation copy rather than
  restated
- Architecture: page-level checks (length, missing-canonical, multiple-H1)
  stay in `analyzePage` (`src/lib/crawler/analyze.ts`), unaware of other
  pages. Cross-page checks (the three duplicate/consolidation rules) are a
  separate pass, `applyCrossPageChecks` in the new
  `src/lib/crawler/crossPageChecks.ts`, run once over a run's full page set
  in `runCrawl.ts` after page-level analysis
- Duplicate title/meta comparison normalizes conservatively (trim, collapse
  whitespace, lowercase) before comparing — no semantic/similarity
  judgment — and never flags pages with an empty/missing value (those are
  already covered by the missing-value rules)
- `duplicate_canonical` is deliberately narrow: only *valid, same-host*
  canonicals participate (a page already flagged `invalid_canonical` is
  excluded, so a broken canonical isn't double-counted); a page whose own
  URL *is* the shared target is never flagged (that's the ordinary,
  legitimate "self-referencing canonical hub" pattern); and it only fires
  when **2 or more** other, distinct pages defer to the same target — one
  duplicate page deferring to one canonical page is normal, expected
  canonical usage and is not flagged
- A redirect-based finding and a robots.txt-based finding were both
  considered here and deliberately deferred at the time (out of scope for
  this milestone's brief) — both were later implemented as required gaps
  in Milestone 6 (see below): `redirected` and `blocked_by_robots_txt`.
- All 9 new types automatically participate in SEO Health, Top
  Opportunities, and Historical Changes with no code changes to
  `seoHealthReport.ts` or `seoChangeReport.ts` — both are driven entirely
  by `ISSUE_TAXONOMY` membership, not a hardcoded type list
- Schema: `crawl_issues.issue_type`'s check constraint needed widening to
  accept the new values (migration `0004_seo_rules_expansion.sql`, not yet
  applied remotely) — no new tables or columns; every new rule is derived
  from data `crawl_pages` already stores

### Milestone 5b: Canonical Chains + Analyzer Test Coverage (`supabase/migrations/0007_canonical_chain_issue_type.sql`)
- Before adding anything, the existing crawler/analyzer/taxonomy were
  audited against a requested checklist of metadata/structure/indexability
  checks (missing/short/long title & meta description, missing/multiple
  H1, non-2xx, noindex, missing canonical, canonical pointing elsewhere).
  Every item except one already existed from Milestone 2/5 — nothing in
  that list was re-implemented or duplicated.
- The one genuine gap: a canonical pointing to a *different* URL was only
  ever flagged as an outright problem when the target was cross-domain
  (`invalid_canonical`) or when 2+ *other* pages also deferred to the same
  target (`duplicate_canonical`, cross-page). A single page whose
  canonical points to a different, same-host URL was — correctly —
  never flagged on its own, since that's ordinary, legitimate canonical
  usage (pagination, tracking-param stripping, print/AMP variants, etc.)
  and assuming otherwise would be a false positive.
- New check: **`canonical_chain`** (Indexability, Medium) — fires when
  page A's canonical points to another page B that *was also crawled in
  this same run*, and B's own canonical doesn't self-reference (B defers
  further, to a third URL, or back to A). This is a real, deterministically
  detectable technical-SEO problem (chained canonicals aren't guaranteed
  to be followed to their true target) distinct from both existing
  canonical checks, computed entirely from `canonicalUrl` values
  `analyzePage` already resolves — no new crawler fetches, no increase to
  crawl scope (`src/lib/crawler/crossPageChecks.ts`). Like the existing
  duplicate checks, it only considers targets that were actually crawled
  in the same crawl run, and excludes pages already flagged
  `invalid_canonical` to avoid compounding an already-reported problem.
- Schema: `crawl_issues.issue_type`'s check constraint widened for this
  one new value (migration `0007_canonical_chain_issue_type.sql`, not yet
  applied remotely) — no new tables/columns, same pattern as `0004`.
- **Test infrastructure added** (there was none in the project before
  this): `vitest` as the sole new devDependency (`npm test` → `vitest
  run`). Chosen over Node's built-in `node:test` because this codebase's
  internal modules use extensionless relative imports (e.g. `from
  "./seoRules"`), which Node's native ESM/TS loader cannot resolve without
  rewriting those imports project-wide — an unrelated, unjustified change
  just to avoid one dependency. 36 focused tests were added:
  `src/lib/crawler/analyze.test.ts` (every page-level check, including
  boundary cases at the exact min/max length thresholds, the
  bot-protection short-circuit, and same-host-but-different-URL
  canonicals *not* being flagged) and
  `src/lib/crawler/crossPageChecks.test.ts` (all three existing duplicate
  checks plus the new canonical-chain check, including a two-page cycle
  and a target outside the crawled set).

### Milestone 5c: Image Alt & Structured Data Checks (`supabase/migrations/0008_image_alt_structured_data_issue_types.sql`)
- Two new deterministic, page-level checks, filling the last two on-page
  areas `CLAUDE.md`'s MVP scope names that weren't covered by Milestone
  5/5b (image alt coverage, structured-data detection/validation —
  automatic schema *implementation* remains explicitly out of scope):
  | issue_type | category | priority | check |
  |---|---|---|---|
  | `images_missing_alt` | Structure | Low | 1+ "meaningful" `<img>` on the page has no `alt` attribute at all |
  | `invalid_structured_data` | Technical | Low | 1+ `<script type="application/ld+json">` block isn't parsable as a JSON object/array |
- **Image alt**: `alt=""` is treated as a deliberate "this image is
  decorative" signal and is never flagged — only a fully *absent* `alt`
  attribute is considered. Of those, a small set of structural signals
  (`role="presentation"`/`"none"`, `aria-hidden="true"`, or an explicitly
  declared ~1x1 tracking-pixel size) are excluded from counting as
  "meaningful," so a missing `alt` there isn't flagged either — no
  guessing about an image's actual visual content, only what the HTML
  itself already declares. One finding per page (not one per image):
  the message states how many images on that page are affected, so a
  page with several missing-alt images still produces exactly one
  opportunity card, consistent with how every other per-page check
  already groups (`src/lib/crawler/html.ts`'s new `extractImages`,
  `src/lib/crawler/analyze.ts`'s `isStructurallyDecorative`).
- **Structured data**: only checks that each JSON-LD script's content is
  non-empty, parses as JSON, and the parsed value is an object or array
  (the only shapes JSON-LD can legally take) — deliberately *not* full
  Schema.org semantic validation (no `@context`/`@type`/property-shape
  checking) and no external Rich Results/validator API call. Same
  one-finding-per-page grouping as image alt: a page with several JSON-LD
  blocks and one broken one gets a single finding naming how many of how
  many are affected (`src/lib/crawler/html.ts`'s new `extractJsonLdBlocks`,
  `src/lib/crawler/analyze.ts`'s `isParsableJsonLd`).
- Both checks reuse the exact same architecture as every prior rule: raw,
  dependency-free regex extraction in `html.ts`, interpretation/flagging
  in `analyzePage` (`analyze.ts`), classification in `ISSUE_TAXONOMY`. No
  new crawler fetches, no crawl-limit change, no changes to
  `seoHealthReport.ts`/`seoChangeReport.ts` — both are driven entirely by
  `ISSUE_TAXONOMY` membership, so the new types participate in SEO Health,
  Top Opportunities, SEO progress, and Historical Changes automatically.
- Schema: `crawl_issues.issue_type`'s check constraint widened for these
  two new values (migration `0008_image_alt_structured_data_issue_types.sql`,
  applied remotely) — no new tables/columns.
- Test coverage extended: `src/lib/crawler/html.test.ts` (new — the
  project's first tests for the raw HTML-extraction layer itself:
  `extractImages`/`extractJsonLdBlocks` against real HTML strings) plus
  24 new cases added to `src/lib/crawler/analyze.test.ts` covering both
  checks, including the specific false-positive protections above.

### Milestone 5d: Expanded Crawl Coverage (5 → 20 pages, `src/lib/crawler/runCrawl.ts`)
- `MAX_PAGES_PER_CRAWL` raised from 5 to 20 (seed page + up to 19 same-site
  internal links, still single-hop/no recursion — unchanged crawl shape,
  just a larger cap). No sitemap crawling, no `robots.txt` parsing, no
  change to any issue-detection rule.
- Additional pages (beyond the seed, which is always fetched alone first)
  are now fetched in small concurrent batches of 5 (`FETCH_CONCURRENCY`)
  rather than strictly one at a time, so the worst-case total crawl time
  stays ~40s — the same worst case the old 5-page *sequential* crawl
  already had (5 × 8s) — despite covering up to 4x more pages, keeping the
  page's existing `maxDuration = 60` safety margin intact. `fetchPage`'s
  existing SSRF checks, redirect handling, per-page 8s timeout, and
  bot-protection-block semantics are all unchanged and still apply
  per-fetch inside each batch.
- New `normalizeForDedup` helper: crawl-time-only URL comparison that
  strips the fragment and a single trailing slash on non-root paths before
  deduplicating discovered links (and before excluding a link back to the
  seed page). Deliberately does not touch query strings — those can
  represent genuinely different pages and are never merged.
- Reporting compatibility preserved by construction: SEO Health,
  Opportunities, `duplicate_*`/`canonical_chain` cross-page checks, and
  Historical Changes are all driven by whatever page set a given run
  actually produced, so older runs recorded with 5 pages remain valid and
  comparable — nothing assumes a fixed page count.
- New `src/lib/crawler/runCrawl.test.ts` (12 tests, `fetchPage` mocked):
  cap stops at `MAX_PAGES_PER_CRAWL`; external-domain links are never
  followed; exact-duplicate and fragment/trailing-slash-variant links are
  each crawled once; query-string variants are correctly *not* merged;
  a self-referencing trailing-slash link back to the seed is excluded;
  non-HTML asset URLs are skipped; a bot-protection-blocked seed page
  fails the whole run; an unreachable or bot-protection-blocked
  *additional* page doesn't abort the run or affect its sibling pages.

### UI/UX Branding Foundation (Techtivo/MARKO visual identity)
- Logo/favicon: `/public/branding/techtivo-marko.png` and `favicon.ico`
  (provided assets, never generated/modified/renamed) wired through a
  shared `src/components/MarkoLogo.tsx` component — image on top, "MARKO"
  as real text underneath (the image itself contains only the Techtivo
  mark), used identically on the login page and the dashboard header. The
  favicon is wired via `metadata.icons` in `src/app/layout.tsx` (the
  default Next.js `app/favicon.ico` file-convention route was removed so it
  can't conflict with it) with a `?v=` cache-busting query string (which
  required allowlisting local image query strings in `next.config.ts`'s
  `images.localPatterns` — Next.js 16 blocks them by default).
- MARKO primary color: `#339595`, defined once as CSS custom properties in
  `src/app/globals.css` (`--color-primary`/`-hover`/`-strong`/`-tint`) and
  exposed to Tailwind v4 via `@theme inline`, so `bg-primary`/`text-primary`
  /etc. are real utilities everywhere rather than a repeated literal. The
  base color measures ~3.6:1 contrast on white — enough for large text/UI
  components/fills-with-white-text, not for small body text/links, which is
  why `primary-strong` (a darker shade, ~7:1 on white) exists and is used
  for text-sized link/label color instead.
- Global font: Inter, loaded via `next/font/google` in `src/app/layout.tsx`
  and applied through `--font-sans` in `globals.css`. This also fixed a
  pre-existing bug: the previous font (Geist) was loaded but never actually
  applied to `body` (a hardcoded `font-family: Arial...` was overriding
  it), so the app had been silently rendering in the browser's default
  serif/sans-serif fallback the whole time.
- Login page and the dashboard header shell were restyled to match a
  reference visual identity ("JIRITA") shared by the same parent product —
  card width/padding/radius/shadow, heading/label/input/button typography
  (labels specifically: `block text-[10px] font-bold uppercase
  tracking-widest text-slate-400 mb-1.5`, matching the reference's own
  computed styles exactly, not an approximation), and the logo lockup's
  proportions were pixel-measured against reference screenshots (Python/PIL
  analysis of actual rendered dimensions) rather than eyeballed.
- Deliberately scoped to shell/foundation styling only: the SEO report page
  ([siteId]'s health summary/opportunities/change cards, badges, table)
  was left on its pre-existing visual style — flagged in every pass as
  explicitly out of scope, pending a future dedicated pass.

### Signup Onboarding (organization name captured at signup)
- The sign-up form (`/login`) now asks for **Organization name** (above
  Email, same label treatment) in addition to email/password
  (`src/app/login/page.tsx`). Validated client-side (trim, non-empty, ≤100
  chars) via shared `src/lib/organizationName.ts`
  (`normalizeOrganizationName`, `ORGANIZATION_NAME_MAX_LENGTH`).
- The name is stored as `pending_organization_name` in the Supabase auth
  user's metadata at `signUp()` time (`options.data`) — survives the
  email-verification redirect with no new storage and no migration.
- On successful verification, `/auth/callback`
  (`src/app/auth/callback/route.ts`) automatically creates the organization
  via the existing `create_organization` security-definer RPC (never a
  direct table insert) and clears the pending metadata, so a normal signup
  never sees the manual "Create your organization" screen.
- `requireUserAndOrganization()` (`src/lib/organizations.ts`) has a
  fallback for users who reach a protected page without having gone
  through the callback route (e.g. verified earlier, signing in normally
  later): if there's no membership and `pending_organization_name` is
  still present, it retries the same RPC. Existing users with no org and no
  pending name are unaffected — they still see the manual screen.
  Idempotency is guaranteed by membership existence, not by whether the
  metadata was cleared: once `create_organization` succeeds once, no later
  call re-attempts creation for that user, regardless of metadata state.
  `requireUserAndOrganization` is wrapped in React's `cache()` because
  `dashboard/layout.tsx` and `dashboard/page.tsx` both call it and Next.js
  fetches layout/page data in parallel — without deduping, both calls would
  race the auto-creation logic against each other on every first load.
- **Bug found and fixed during this work**: an earlier version cleared the
  pending metadata via `supabase.auth.updateUser()` from inside
  `requireUserAndOrganization()`, which runs in Server Components. Server
  Components cannot write cookies, and `updateUser()` is a session-mutating
  auth call (it fires a `USER_UPDATED` event that `@supabase/ssr`'s client
  listens for to persist the session via a cookie write) — calling it from
  there caused the dashboard to hang indefinitely right after email
  verification. Root-caused by tracing the actual `@supabase/auth-js`/
  `@supabase/ssr` library internals in `node_modules` (not guessed). Fixed
  by moving the metadata-clearing call to `/auth/callback` (a Route
  Handler, which *can* safely mutate the session); the Server-Component
  fallback path now only ever calls the plain RPC, which has no
  session/cookie side effects.

### Google Search Console Integration Foundation (`supabase/migrations/0009_google_search_console.sql`)
- **Google OAuth connection, org-level**: `src/app/dashboard/google/connect/route.ts`
  starts the flow (CSRF `state` in an httpOnly cookie, `access_type=offline`
  + `prompt=consent` so a refresh token is always issued);
  `src/app/auth/google/callback/route.ts` validates `state`, exchanges the
  code for tokens, and persists them. Scope is the single minimum
  read-only one: `https://www.googleapis.com/auth/webmasters.readonly`
  (`src/lib/googleSearchConsole/config.ts`). The connection belongs to the
  organization, not a specific site or user — one Google account per org.
- **Token storage/security**: new `google_connections` table holds the
  refresh/access tokens. It intentionally has no grants or RLS policies
  for `authenticated`/`anon` at all — this project has "Automatically
  expose new tables" disabled, so simply never granting access means
  PostgREST (and therefore every browser-side and RLS-scoped server-side
  call) cannot reach it under any policy. The only access path is
  Postgres's `service_role`
  (`src/lib/supabase/serviceRole.ts` — a new, separate client, never
  imported by anything client-side, gated by a non-`NEXT_PUBLIC_` env
  var), used exclusively from
  `src/lib/googleSearchConsole/connectionStore.ts`. A normal
  RLS-scoped request can still learn *whether* a connection exists/is
  healthy — never the tokens — via the security-definer
  `get_google_connection_status()` RPC.
- **Token refresh**: access tokens are refreshed server-side, proactively
  (before the stored expiry, not reactively on a 401), via
  `src/lib/googleSearchConsole/tokens.ts`. A refresh failure with
  Google's `invalid_grant` error (the documented signal for a revoked/
  expired refresh token) sets `needs_reauth = true` on the connection,
  surfaced as a distinct "Reconnect required" UI state rather than a
  generic failure or a silent retry loop.
- **Search Console property association**: `sites` gained two nullable
  columns (`search_console_property_url`, `search_console_property_type`)
  rather than a new join table — a site has at most one property. Set
  only through a narrow security-definer RPC
  (`set_site_search_console_property`, same pattern as
  `archive_site`/`restore_site` from Milestone 1's site lifecycle work),
  never a general `sites` UPDATE grant. Both URL-prefix
  (`https://example.com/`) and Domain (`sc-domain:example.com`) property
  types are supported.
- **Property matching**: `src/lib/googleSearchConsole/propertyMatching.ts`
  (pure, unit-tested) only ever pre-selects a property in the picker when
  there is exactly one unambiguous exact match (scheme-sensitive
  URL-prefix match, or domain match ignoring a `www.` prefix) — zero or
  multiple candidates always leave the picker for the user to choose
  manually. Even a pre-selected match still requires an explicit "Use
  this property" click; nothing is silently auto-saved. Saving itself
  re-verifies (server-side, via a fresh Search Console API call) that the
  submitted property is actually one the connected account has access to
  before persisting — a stale or tampered client value can't be saved.
- **Performance snapshot**: `src/lib/googleSearchConsole/dateRange.ts`
  computes the latest available 28-day window assuming a fixed,
  documented 3-day Search Console reporting lag (`GSC_DATA_LAG_DAYS`) —
  today's date is never assumed to have data — plus the immediately
  preceding comparable 28 days. `snapshot.ts` aggregates Google's
  no-dimension `searchAnalytics.query` rows into clicks/impressions/CTR/
  average position and computes a purely factual delta between the two
  periods (no "improvement"/"regression" labeling — CLAUDE.md's AI Usage
  Principles). A period with zero rows is tracked as "no data available",
  distinct from a genuine zero.
- **Minimal UI**: `src/components/seoReport/GoogleSearchConsoleCard.tsx`
  (new card on the site detail page, outside the existing ROW 1 grid —
  the existing Site Report layout was not redesigned) shows connection
  state (Not connected / Connected / Reconnect required), a "Connect"/
  "Reconnect" action, the property picker once connected, and the plain
  metric readout with previous-period deltas once a property is set. No
  charts; GSC metrics are not merged into the existing SEO Progress chart.
- **Tests**: `src/lib/googleSearchConsole/*.test.ts` (OAuth state
  validation, property exact/no-match/multiple-match behavior, date-range
  math, metric aggregation, delta calculation, expired-token refresh
  behavior) and
  `src/app/dashboard/sites/[siteId]/googleSearchConsoleActions.test.ts`
  (tenant/site ownership checks, property-ownership re-verification) — all
  with Google/Supabase calls mocked, no live network/DB access, following
  the same mocking pattern `runCrawl.test.ts` established.
- **Environment variables** (see `.env.example`, no real secrets there):
  `SUPABASE_SERVICE_ROLE_KEY` (server-only, bypasses RLS — see
  `src/lib/supabase/serviceRole.ts`), `GOOGLE_OAUTH_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` (must exactly
  match an Authorized redirect URI on the Google Cloud OAuth client —
  `http://localhost:3000/auth/google/callback` locally).
- **Not done in this milestone** (see CLAUDE.md's explicit constraints):
  no scheduled/background token refresh or data sync (both happen lazily,
  on page load, driven by a real request); GSC metrics are not yet used to
  enrich SEO Health/Opportunities/prioritization or shown in SEO Progress;
  no automatic recommendations based on traffic.

### MARKO Insights (`src/lib/reporting/markoInsights.ts`)
- Deterministic interpretation layer over data that already exists —
  `SeoHealthReport` (issues, priority/category, affected pages, pages
  analyzed) and `SeoChangeReport` (resolved/new/remaining, with the
  existing newly-analyzed-page protection). No AI/LLM call, no external
  API, and explicitly **no Search Console dependency** — GSC performance
  data still does not factor into prioritization anywhere (see the GSC
  milestone above).
- Three insight types, capped at 5 total, ranked by priority then affected-
  page count (deterministic tie-break by insight id): **PRIORITY** (the
  single highest-priority current finding), **COVERAGE** (a different
  finding affecting ≥50% of analyzed pages, `PREVALENCE_THRESHOLD_RATIO`),
  and **RECENT CHANGE** (resolved-count / genuinely-new-count insights, plus
  a single "remains widespread" pick for an issue persisting ≥50% across
  both the previous and latest analysis — only shown when a comparable
  previous run exists). Each issue type is claimed by at most one insight
  (a widespread issue that's also the top-priority pick isn't restated as
  both), and there's no minimum count — a clean report legitimately
  produces zero insights rather than inventing filler.
- Every insight's explanation states only counts/percentages/labels already
  present in the underlying reports (e.g. "4 of 5 analyzed pages (80%) have
  this finding") — no causal, traffic, ranking, or business-impact claims.
- UI: `src/components/seoReport/MarkoInsightsCard.tsx` replaces the earlier
  static placeholder, in the Site context column. Its "View affected pages"
  action reuses the exact same `AnalysisDetailModal`
  (`src/components/seoReport/AnalysisHistoryList.tsx`, now exported) and
  `getCrawlRunDetail` the Analysis History column already uses for the
  latest completed run — no new detail view, no new fetch.
- Tests: `src/lib/reporting/markoInsights.test.ts` (12 cases) covering
  ranking, prevalence/coverage, priority, deduplication (same issue never
  claimed by two insight types), recent-change resolved/new, the
  newly-analyzed-page regression-protection guarantee, the 5-insight cap,
  and both empty-state paths.

### Site slug routing (`supabase/migrations/0011_site_slugs.sql`)
- Site detail URLs are now `/dashboard/sites/<slug>` (e.g.
  `/dashboard/sites/techtivo`) instead of `/dashboard/sites/<uuid>` — the
  route folder itself was renamed
  `src/app/dashboard/sites/[siteId]/` → `.../[slug]/`. `sites.id` (uuid)
  remains the sole internal identity/FK reference everywhere else
  (crawl_runs, crawl_pages, crawl_issues, the Search Console property
  association, Analysis History, MARKO Insights) — nothing about those
  relationships changed; `slug` is purely an additional, publicly-routable
  alias.
- New `sites.slug` column, `not null`, unique **per organization** (not
  globally) via `sites_organization_id_slug_key` — two different
  organizations can each have a site slugged "techtivo".
- Slug generation/collision handling (`base`, `base-2`, `base-3`, …) is
  pure TypeScript (`src/lib/sites/slug.ts`: `slugify`, `resolveUniqueSlug`),
  used by `createSite` (`src/app/dashboard/sites/actions.ts`) at creation
  time — a best-effort pre-check against the org's existing slugs, with a
  single retry on a `23505` unique-violation race (a narrow, documented
  accepted race window, same posture as the existing organization
  auto-creation race noted above). The migration has its own,
  intentionally independent one-time SQL version of the same algorithm
  (`slugify`/`generate_unique_site_slug` functions) used only to backfill
  existing rows in a stable (`organization_id, created_at, id`) order —
  frozen historical script, not living code the app depends on.
- Route resolution: `resolveSiteBySlug`
  (`src/app/dashboard/sites/[slug]/resolveSite.ts`) looks up the site by
  `(organization_id, slug)` together — never slug alone — so a slug that
  happens to collide with another organization's site can never resolve
  into that tenant's data; RLS is unchanged and still independently
  enforces the same boundary (defense in depth, same double-check pattern
  `getCrawlRunDetail`/`associateSiteProperty` already use).
- Every internal link/redirect that used to embed the site UUID now goes
  through one shared `siteDetailPath(slug)` helper
  (`src/lib/sites/paths.ts`): the dashboard site grid, `runSeoAnalysis`'s
  redirects, and `associateSiteProperty`'s `revalidatePath` call.
- No organization-slug routing, no public (unauthenticated) Site pages, no
  redirect/alias for a renamed slug, and no slug-editing UI — none of
  those were requested; slugs are assigned once at creation and never
  change today.
- Tests: `src/lib/sites/slug.test.ts` (slug generation, collision
  handling, and a backfill-order simulation), `src/lib/sites/paths.test.ts`,
  and `src/app/dashboard/sites/[slug]/resolveSite.test.ts` (tenant-scoped
  resolution and — the security-critical case — that a slug never resolves
  outside the caller's own organization).
- **Search Console property switching removed** in the same pass: the site
  detail page's Search Console card no longer offers "Change property" or
  any manual property picker (`src/components/seoReport/
  GoogleSearchConsoleCard.tsx`) — only the existing automatic exact-match
  behavior can ever associate a property, so the data shown always belongs
  to the property MARKO itself matched to that site. `clearSiteProperty`
  (the Server Action backing the removed button) was deleted;
  `clear_site_search_console_property` (its RPC) was deliberately left in
  the database rather than dropped — unused but harmless, and dropping
  database functions was out of scope for this pass.
- **Applied remotely** (confirmed via `supabase migration list --linked`
  during the Milestone 6 QA pass below — all migrations through `0012` are
  applied to the linked project).

### Milestone 6: robots.txt Blocking Detection + Redirect Transparency (`supabase/migrations/0012_robots_txt_and_redirect_transparency.sql`)
- Follows a read-only MVP coverage audit that classified every crawler/
  analysis gap as REQUIRED/SUGGESTED/FUTURE against `CLAUDE.md`'s named
  crawl scope. Only the two REQUIRED items — both risking a misleadingly
  "all clear" report — were implemented; every SUGGESTED/FUTURE item
  remains deliberately unimplemented.
- **robots.txt blocking detection** (`src/lib/crawler/robotsTxt.ts`, new):
  fetches `/robots.txt` once per crawl (in parallel with the seed page
  fetch), parses `User-agent`/`Allow`/`Disallow` groups, and evaluates
  blocking per crawled page path against the `googlebot`-applicable group
  (an explicit `googlebot` group fully overrides `*` — never merged, per
  spec) using longest-matching-prefix-wins (`*`/`$` pattern support; a
  length tie resolves to Allow). New `blocked_by_robots_txt` issue
  (Indexability, High/critical) fires only on an otherwise-successful page.
  **False-positive protection**: every inconclusive outcome — missing
  robots.txt (404), network/timeout failure, a non-200/404 status, a
  redirected robots.txt (never followed — a deliberate, documented
  simplification), or no group applicable to `googlebot` — collapses to a
  single `group: null` result, and `group: null` structurally can never
  block anything. Evidence of the fetch itself (`robots_txt_status`,
  `robots_txt_fetch_error`) is persisted on `crawl_runs` for transparency,
  independent of whether blocking was ever applied.
- **Redirect transparency**: `fetchPage.ts`'s `FetchedPage` now carries
  `finalUrl`/`redirectCount` (threaded through every return path, success
  and error alike); `analyze.ts` copies both onto `AnalyzedPage` and raises
  a new `redirected` issue (Technical, Low/warning, purely factual — no
  judgment about whether the redirect is a "problem") whenever an
  otherwise-successful page took 1+ hops. A redirect that fails outright
  (a loop, or exceeding the existing 3-hop limit) is still only reported as
  `http_error`, never double-counted as `redirected` too.
- **Cross-page false-positive protection**: `crossPageChecks.ts` excludes
  any page with `redirectCount > 0` from all four duplicate/consolidation
  checks (title, meta description, canonical-duplicate, canonical-chain) —
  a redirecting page has no independent content of its own, so comparing it
  would produce a false "duplicate"/"chain" finding against the very page
  it redirects to. The page is still returned in the crawl's output and
  still carries its own `redirected` finding; it just never contributes to
  or receives a cross-page finding.
- Both new issue types required zero changes to `seoHealthReport.ts`,
  `seoChangeReport.ts`, `markoInsights.ts`, or any badge/table component —
  all are driven entirely by `ISSUE_TAXONOMY` membership (confirmed, not
  assumed), consistent with every prior milestone's rule additions.
- Schema: `crawl_runs` gained nullable `robots_txt_status`/
  `robots_txt_fetch_error`; `crawl_pages` gained nullable `final_url` and
  `redirect_count` (`not null default 0`); `crawl_issues.issue_type`'s
  check constraint widened for the two new values — all additive/nullable,
  same pattern as `0004`/`0007`/`0008` (migration
  `0012_robots_txt_and_redirect_transparency.sql`, **applied remotely** —
  confirmed via `information_schema`/`pg_constraint` during the Milestone 6
  QA pass below).
- Tests: `src/lib/crawler/robotsTxt.test.ts` (new — group parsing/
  precedence, pattern matching incl. `*`/`$`/tie-break, and every fetch
  outcome: missing, permissive, full-site block, path-specific block,
  malformed/unreachable, googlebot-overrides-wildcard); extended
  `analyze.test.ts` (redirected/blocked_by_robots_txt raised and *not*
  double-counted alongside `http_error`), `crossPageChecks.test.ts`
  (redirect-source exclusion from all four checks), and `runCrawl.test.ts`
  (end-to-end robots.txt blocking with the fetch mocked but real parsing/
  matching, inconclusive-fetch-never-blocks, and redirect evidence flowing
  through to the final `AnalyzedPage`).

#### Milestone 6 QA pass (Phase 1 MVP end-to-end audit)
- Precondition confirmed: migration `0012` (and all migrations through it)
  applied to the linked project; live schema (`information_schema`,
  `pg_constraint`) matches code exactly.
- Real fresh crawls run against real production sites (Techtivo,
  LendingPoint.com, plus three existing fixture sites — a bot-protection
  case and two known-issue test pages) via the actual RLS-scoped write path
  (a minted real user session, not a service-role bypass — `service_role`
  deliberately has no grants on crawl_runs/crawl_pages/crawl_issues in this
  project). Reporting consistency (health summary math, opportunities
  page-count totals, change-report new/resolved/remaining, MARKO Insights
  dedup/cap) was verified programmatically against the persisted rows, not
  just eyeballed.
- **Defect found and fixed**: `resolveInternalLinks` (`runCrawl.ts`) was
  fetching the *dedup-normalized* (trailing-slash-stripped) form of every
  discovered link rather than the link's literal HTML form. On any site
  whose own pages consistently author URLs with a trailing slash (both
  Techtivo and LendingPoint do), this made MARKO trigger a same-site
  redirect on nearly every crawled page purely as a side effect of its own
  bookkeeping — invisible before Milestone 6, but actively misleading once
  Milestone 6 started surfacing `redirected` findings (19 of 20 pages
  flagged as "redirects" on both sites' fresh crawls, none of it real).
  Fixed by keeping the normalized form only as the dedup *key*, while
  fetching the original (fragment-stripped only) literal URL — confirmed
  against real data: 0 redirected pages on both sites after the fix. Three
  regression tests added to `runCrawl.test.ts`.
- **Defect found and fixed**: `selectApplicableGroup` (`robotsTxt.ts`) took
  only the *first* robots.txt group matching a given user-agent token via
  `.find()`, silently discarding any later group sharing the same token —
  contrary to the documented spec (matching groups for the same token must
  be merged, not just the first one honored). Surfaced by LendingPoint's
  real robots.txt, which genuinely has two separate `User-agent: *` blocks
  (a hand-written one, then a Yoast-plugin-appended one) — the second
  block's `Disallow: /search/` etc. was being silently ignored. Fixed by
  merging all matching groups' directives before evaluating blocking; one
  regression test added to `robotsTxt.test.ts` reproducing the real shape.
- Both fixes are narrow, root-cause, no scope change: 210/210 tests pass,
  lint/typecheck/build clean.
- Verified via real crawl output, not assumption: robots.txt blocking (0
  false positives on either site, cross-checked against each site's actual
  `Disallow` rules and the actual crawled paths), a real `non_indexable`
  finding on LendingPoint traced to a genuine `noindex, follow` directive
  (not a false positive), and the bot-protection failure path (a known
  WAF-protected fixture site) correctly returning a clean `ok: false`
  with no fabricated crawl_pages/crawl_issues rows.
- **Not verified this pass** (no browser automation available in this
  session): pixel-level visual layout, the ResizeObserver-based MARKO
  Insights/Preview height sync, and live scroll/overflow/mobile-breakpoint
  behavior. These were reviewed at the code level only (grid structure,
  `overflow-y-auto`/`min-h-0` classes, `lg:` breakpoint) — genuinely
  untested in an actual browser this pass.

## Current architecture

- Generic account/tenant infrastructure (`organizations`,
  `organization_memberships`, `sites`, auth) is kept independent of any
  SEO-specific domain logic, so future specialist agents can share it.
- Google Search Console logic lives entirely under
  `src/lib/googleSearchConsole/` (OAuth client, token storage/refresh,
  Search Console API client, property matching, date-range/snapshot math
  — mostly small, pure, independently-testable modules, same philosophy
  as `src/lib/crawler/`), plus the two Route Handlers that must exist
  outside that lib (`src/app/dashboard/google/connect/route.ts`,
  `src/app/auth/google/callback/route.ts` — Google's own redirect-based
  OAuth flow needs real HTTP routes, not Server Actions). This is the
  project's first use of the Supabase `service_role` key
  (`src/lib/supabase/serviceRole.ts`) — every other table/query in the
  project goes through the normal RLS-scoped client.
- SEO crawl logic lives entirely under `src/lib/crawler/` (fetch, HTML
  extraction, page-level issue analysis, and cross-page issue analysis are
  separate, dependency-free, mostly pure modules) and is orchestrated only
  from `src/app/dashboard/sites/[siteId]/actions.ts` — it does not reach
  into tenant/auth internals beyond the existing
  `requireUserAndOrganization()` helper. Page-level checks
  (`analyze.ts`) and cross-page/duplicate checks (`crossPageChecks.ts`) are
  deliberately separate modules with a clear one-way data flow
  (`runCrawl.ts` runs page-level analysis for every page, then a single
  cross-page pass over the full set).
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
- Testing: `vitest` (`npm test`) covers the deterministic crawler/analyzer
  rules only (`src/lib/crawler/*.test.ts`) — no component/integration
  tests exist yet. Test files live alongside the modules they cover.
- Shared UI lives in `src/components/` (currently just `MarkoLogo.tsx`,
  the app's first shared component). Brand tokens (color, font) are
  defined once in `src/app/globals.css` and consumed everywhere else via
  Tailwind utilities — no page hardcodes a hex value or font name.
- Architectural rule (learned from the onboarding hang, see above):
  session-mutating Supabase auth calls (`updateUser`, `signOut`, etc.) must
  only be called from Route Handlers or Server Actions, never from Server
  Components, which cannot write cookies. Compare
  `src/app/auth/callback/route.ts` (safe) with `src/lib/organizations.ts`'s
  Server-Component-invoked fallback (RPC-only, no auth mutation).

## Known limitations

- No invitations or team management — an organization has exactly one
  member (its creator) until that's built.
- No organization settings/editing.
- No password reset / magic-link flow.
- No org switcher — a user with multiple memberships will only see their
  first organization in the UI.
- Site deletion exists as a soft-delete (archive/restore via the
  `archive_site`/`restore_site` security-definer RPCs, wired to a real UI
  control in `SiteMenu.tsx`) — not a limitation. What's actually missing:
  **field-level editing** of a site's name or URL after creation; no update
  action exists for either.
- `sites` has no per-row UPDATE/DELETE RLS policies yet (archive/restore
  goes through the security-definer RPCs above, not a direct grant; a
  future name/URL edit flow would need its own RLS policy or RPC).
- Crawl trigger is a synchronous request/response — a very slow target site
  can make "Run SEO analysis" take up to roughly 40s worst case (the seed
  page's 8s fetch, plus up to 19 more pages fetched in concurrent batches
  of 5, each batch bounded by the same 8s per-page timeout), within the
  route's `maxDuration = 60`. Acceptable for a manual, local-first MVP
  action; would need a background job for a serverless production
  deployment with tighter platform request timeouts — out of scope per
  "no scheduled/background crawling."
- robots.txt is fetched once per crawl and evaluated only against the
  `googlebot` user-agent token — not per-page, and not against any other
  crawler's token (Bingbot, etc.). A robots.txt reachable via redirect is
  never followed (treated as inconclusive, never blocking) — a documented,
  deliberate simplification (Milestone 6) that trades a rare false-negative
  for zero false-positive risk.
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
- `duplicate_title`/`duplicate_meta_description`/`duplicate_canonical`/
  `canonical_chain` are computed only within a single crawl run's own page
  set (at most 20 pages) — they cannot detect duplicates/chains against
  pages outside that run's sample.
- `images_missing_alt`'s "meaningful image" heuristic is deliberately
  narrow and purely structural (role/aria-hidden/declared ~1x1 size) — it
  cannot know an image is decorative from its actual visual content (e.g.
  a background-style spacer GIF at a normal declared size, or a CSS
  `background-image` used for a meaningful photo, which this check
  doesn't see at all since it only inspects `<img>` elements).
- `invalid_structured_data` only checks JSON parseability/shape, never
  Schema.org correctness — a JSON-LD block that parses fine but has the
  wrong `@type`, missing required properties, or otherwise wouldn't
  qualify for a specific rich result is not detected (that would need
  either a bundled Schema.org validator or an external API call, both out
  of scope here).
- The SEO report page's own visual details (health summary/opportunities/
  change cards, severity/priority/category badges, per-page table) have not
  been updated to the new Techtivo/MARKO visual identity — still on the
  pre-branding-pass style, pending a dedicated future pass.
- Organization auto-creation at signup has a narrow, explicitly-accepted
  race window: two genuinely simultaneous first page loads (e.g. two tabs
  opened at the same instant) could each pass the "no membership yet"
  check before either commits, creating two organizations for that user.
  Closing this fully would need a DB constraint tying a user to at most one
  organization, which would conflict with preserving multi-org-membership
  support — so it's accepted, not solved.
- Signup only captures an organization name (validated: trimmed,
  non-empty, ≤100 characters) — no slug, business profile, or other
  fields.
- Search Console's "latest available 28 days" assumes a fixed 3-day
  reporting lag (`GSC_DATA_LAG_DAYS` in
  `src/lib/googleSearchConsole/dateRange.ts`) rather than checking what
  Google actually has processed yet — a conservative, documented
  approximation, not a live freshness check.
- One Google connection per organization, not per site — every site in
  an org shares the same connected Google account (but each site has its
  own, independently chosen, Search Console property). No UI exists to
  disconnect a Google account or see which Google email is connected
  (the OAuth scope used deliberately excludes email/profile access, to
  stay at the minimum required scope).
- No automatic/background token refresh or performance-data sync — both
  happen lazily, triggered by an actual page load, per this milestone's
  explicit "no scheduling/background jobs" constraint.
- Search Console performance data is not yet used anywhere beyond its own
  card: it doesn't factor into SEO Health, Top Opportunities, or SEO
  Progress.

## Deferred scope (explicitly out of this checkpoint)

GA4/GBP integration, GEO monitoring, AI-assisted analysis, 0–100 SEO
health scoring, full Schema.org structured-data *semantic* validation
(only JSON parseability is checked — see Milestone 5c), automatic
structured-data/schema implementation, multi-run (more than two) trend
reporting, ticketing, Developer Agent, auto-fixes, and any mock/fake
analytics. See `CLAUDE.md` for the full list.

Google Search Console itself now has an integration *foundation* (OAuth
connection, property association, a raw performance snapshot — see the
milestone above), but GSC data is not yet used anywhere beyond its own
minimal test UI: it does not enrich SEO Health/Opportunities
prioritization, does not appear in SEO Progress, and there is no
scheduled/background sync (data is only ever fetched live, on page load).

MARKO Insights (see the milestone above) is deliberately scoped to a small,
deterministic MVP set. Explicitly deferred: Search-Console-informed
insights (e.g. "this problem is on a page that already ranks well" — needs
a product decision on how GSC should influence prioritization, same
open item as above); trend insights spanning more than two analyses (only
latest-vs-previous is compared, same limitation as Historical SEO Changes);
per-page (rather than per-issue-type) insights; and any dismiss/snooze/
acknowledge interaction — insights are read-only and recomputed fresh on
every render, nothing is persisted about them.

## Next logical milestone

Product feature track: use the now-connected Search Console performance
data to actually enrich prioritization and reporting — e.g. a page with
an SEO problem that already has real impressions/clicks is a stronger
opportunity than one with none (per CLAUDE.md's Search Console section) —
and/or fold GSC clicks/impressions into the SEO Progress trend view.
Requires a product decision on exactly how GSC data should influence
opportunity ranking before implementation (CLAUDE.md: "Any SEO health
score must be explainable... rather than arbitrary AI judgment").

UI track (independent, not blocking the above): extend the Techtivo/MARKO
visual identity to the SEO report page itself (including the new Search
Console card), which the branding pass deliberately left untouched.
