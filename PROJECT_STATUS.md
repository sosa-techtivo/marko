# MARKO — Project Status

## Current MVP objective

Per `CLAUDE.md`, the confirmed MVP is an SEO analysis/reporting product for
real websites, demonstrable around September 10–15, 2026. This checkpoint
covers only the initial slice: the SaaS account/auth foundation the SEO
features will be built on top of. No SEO functionality (crawling, findings,
scoring, GSC, reporting) exists yet.

## Completed functionality

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
- Multi-tenant database foundation (`supabase/migrations/0001_init.sql`):
  - `organizations` — represents a client/business account; not
    auto-created, never tied to auth signup
  - `organization_memberships` (many-to-many, a user may belong to multiple
    organizations; no role/permission column — membership existence is all
    that's needed for tenant isolation)
  - `sites`
  - Row Level Security on all three tables, scoped to the caller's
    memberships
  - `create_organization(org_name)` — a `security definer` function and the
    *only* way to create an organization; atomically inserts the
    organization and the caller's membership row
- Minimal organization creation flow: on `/dashboard`, a user with no
  organization sees a "Create your organization" form (name only), calling
  `create_organization` via RPC
- Minimal site creation flow: `/dashboard/sites/new` form (name + URL) that
  inserts into `sites` scoped to the user's organization, available once an
  organization exists
- Dashboard site list reads real data from Postgres; shows a genuine empty
  state (no mock/fake data) when no sites exist yet

## Current architecture

- Generic account/tenant infrastructure (`organizations`,
  `organization_memberships`, `sites`, auth) is kept independent of any
  SEO-specific domain logic, so future specialist agents can share it.
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

## Deferred scope (explicitly out of this checkpoint)

Crawler, technical/on-page SEO rules, structured data validation, AI
analysis, Google Search Console/GA4/GBP integration, GEO monitoring, SEO
health scoring, reporting, historical tracking, ticketing, Developer Agent,
auto-fixes, and any mock/fake analytics. See `CLAUDE.md` for the full list.

## Next logical milestone

Website crawler (read-only) producing raw technical/on-page observations for
a `site`, as the first input to the findings pipeline described in
`CLAUDE.md`.
