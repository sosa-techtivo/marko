# MARKO

MARKO is an AI-powered SEO marketing agent. This repository currently contains the SaaS account/auth foundation the SEO product will be built on — see `PROJECT_STATUS.md` for current scope.

## What is MARKO?

MARKO is an AI-powered marketing agent designed to help businesses understand
and improve their digital presence.

The first MARKO agent focuses on SEO. It analyzes websites, identifies technical
and content opportunities, tracks improvements over time, and turns SEO data
into clear, actionable reports.

### Current MVP scope

The first version focuses on:

- Website crawling and technical SEO analysis
- SEO health and issue detection
- Actionable optimization opportunities
- Progress tracking over time
- Reporting focused on measurable improvement

MARKO is intentionally starting narrow: become useful at SEO before expanding
into additional marketing agents.

## Stack

- Next.js (App Router, TypeScript)
- Tailwind CSS
- Supabase (Auth + Postgres, via `@supabase/ssr`)

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

Create a project at [supabase.com](https://supabase.com) (or use an existing one).

### 3. Apply the database migrations

In the Supabase dashboard, open **SQL Editor** and run the files in
`supabase/migrations/` **in order** (`0001_init.sql`, then
`0002_grant_authenticated_table_privileges.sql`, then
`0003_seo_crawl.sql`). Together they create:

- `organizations`, `organization_memberships`, `sites` tables
- Row Level Security policies scoping all access to the caller's organization memberships
- A `create_organization` database function — the only way to create an organization; it atomically creates the organization and the caller's membership row
- The base `authenticated` table grants PostgREST requires to reach those RLS policies at all (only needed if your project has "Automatically expose new tables" disabled in Studio — plain SQL migrations don't grant those automatically the way the table-editor GUI does)
- `crawl_runs`, `crawl_pages`, `crawl_issues` — historical SEO crawl runs and their results, same RLS + grant pattern

If you use the [Supabase CLI](https://supabase.com/docs/guides/cli) instead:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### 4. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from
**Project Settings -> API** in the Supabase dashboard.

### 5. Disable email confirmation for local testing (optional)

By default Supabase requires email confirmation before a new user can sign in.
For quick local testing, you can turn this off in **Authentication -> Providers -> Email**
in the Supabase dashboard. In production, keep confirmation enabled and configure
the Site URL / Redirect URLs (see below).

### 6. Set Auth redirect URLs

In **Authentication -> URL Configuration**, set the Site URL to
`http://localhost:3000` for local development, and add
`http://localhost:3000/auth/callback` to the Redirect URLs list. Update these
to your production domain when deploying.

### 7. Run the app

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000). You'll be redirected to
`/login`; sign up, confirm your email if required, and you'll land on
`/dashboard`. A new account has no organization yet, so you'll be prompted to
create one first — after that you can add your first site, open it, and
click **Run SEO analysis** to crawl it (start URL + up to 4 same-site
internal links) and see an SEO Health Summary and prioritized opportunities
for what to review first.

## Scripts

```bash
npm run dev     # start dev server
npm run build   # production build
npm run start   # run production build
npm run lint    # eslint
```
