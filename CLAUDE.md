# CLAUDE.md — MARKO

## Project Overview

MARKO is an AI-powered marketing agent.

The long-term vision is for MARKO to act like an AI CMO that orchestrates specialist marketing agents such as SEO, social media, content creation, paid media, and others.

However, the current project scope is intentionally much narrower.

MARKO Phase 1 starts with SEO as the first specialist agent.

The immediate MVP must help a business understand:

1. How is my SEO performing today?
2. What are my most important SEO problems and opportunities?
3. What should be improved?
4. Am I improving over time?

The first MVP should be usable with real websites and real Google Search Console data.

---

# Core Product Principle

MARKO is not intended to be a technical SEO tool that simply exposes crawl data.

MARKO should behave like an SEO/marketing specialist.

Raw technical data should be transformed into understandable findings, prioritized opportunities, recommendations, and progress reporting.

Conceptually:

Website Data
→ Analysis
→ Findings
→ Opportunities
→ Recommendations
→ Reporting
→ Progress Tracking

The client should be able to understand the state of their SEO without needing SEO expertise.

---

# Immediate MVP Goal

Build a production-quality but deliberately scoped MVP that can demonstrate MARKO with real websites.

The MVP should allow MARKO to:

* register/configure a client website
* crawl and analyze the website
* establish an SEO baseline
* detect relevant technical and on-page SEO issues
* identify opportunities
* prioritize findings
* provide understandable recommendations
* connect Google Search Console
* use Search Console performance data to enrich analysis
* preserve historical analysis results
* show whether SEO health and organic search performance improve over time
* present this information through a client-facing dashboard/reporting experience

The product should answer:

> This is how your SEO looks today.

> These are your biggest opportunities.

> These are the areas we should work on.

> This is how things are improving.

---

# Scope Rule — IMPORTANT

Do NOT add features simply because they would be useful, standard for a SaaS product, technically elegant, or mentioned as part of MARKO's long-term vision.

Only implement:

1. functionality explicitly requested in the current task;
2. functionality explicitly included in the confirmed MVP scope;
3. minimal technical infrastructure required to support those requirements safely.

When something is ambiguous, prefer the smallest implementation that satisfies the requirement.

Do not silently expand scope.

Do not implement future functionality in advance.

Architecture may allow future expansion, but future features must not be built until requested.

---

# Confirmed MVP Scope

## SaaS / Account Foundation

MARKO is a client-facing SaaS product.

The architecture must support multiple client accounts.

Each client's data must remain isolated.

Users may belong to the appropriate client account(s).

Do not invent complex permissions unless required.

---

## Websites

MARKO analyzes websites associated with client accounts.

The system must eventually store website configuration and analysis history independently per site.

---

## Website Crawl

MARKO needs a crawl-based read layer capable of analyzing a website even when no platform-specific connector exists.

The initial crawler should focus only on information required for the confirmed SEO MVP.

Relevant areas include:

* URLs and HTTP status
* redirects and broken links
* page titles
* meta descriptions
* canonical tags
* robots directives
* heading structure
* image alt text
* internal links
* sitemap
* robots.txt
* Open Graph / social metadata where relevant
* structured data / JSON-LD

Do not attempt to recreate Screaming Frog or build a complete enterprise crawler unless explicitly requested.

---

## Technical SEO

MARKO should detect relevant technical SEO issues such as:

* broken links
* redirect problems
* crawlability problems
* indexability problems
* sitemap inconsistencies
* robots.txt issues
* canonical problems
* missing or problematic metadata
* relevant site structure/internal linking issues

Only implement individual rules when requested or when they are part of an approved milestone.

---

## On-Page SEO

Relevant MVP analysis includes:

* title tags
* meta descriptions
* heading structure
* image alt coverage
* internal linking
* structured data/schema opportunities

Analysis should result in meaningful findings and recommendations rather than exposing only raw values.

---

## Structured Data

MARKO should be capable of:

* detecting existing Schema.org structured data
* validating relevant structured data
* identifying obvious schema opportunities

Automatic implementation of schema is NOT part of the immediate MVP.

---

## Google Search Console

Google Search Console is a priority integration for the MVP.

Each client must authorize access to their own applicable Google properties using OAuth.

MARKO should eventually use Search Console data such as:

* clicks
* impressions
* CTR
* average position
* queries
* pages
* relevant search performance trends

Search Console data should enrich MARKO's prioritization and reporting.

Example:

A page with an SEO problem that already ranks near page one may represent a stronger opportunity than a page receiving no search visibility.

---

## Historical Tracking

MARKO must preserve enough analysis history to establish:

* the initial SEO baseline
* subsequent SEO health changes
* resolved/regressed issues
* Search Console performance changes

The goal is to demonstrate progress over time.

---

## Dashboard / Reporting

The initial product surface is primarily reporting-oriented.

Clients are not expected to directly fix their website through MARKO during this MVP.

The dashboard should communicate:

* current SEO health
* important problems
* important opportunities
* recommendations
* trends
* progress over time
* relevant Google Search Console performance

Prefer clear business language over unnecessarily technical SEO terminology.

Technical details can exist as supporting information.

Do not create fake analytics or fabricated SEO data in production flows.

---

# AI Usage Principles

MARKO is AI-powered, but AI must not be used unnecessarily.

Minimize token consumption and external AI calls.

Use deterministic code when the answer is deterministic.

Examples:

Missing title?
→ Code/rule.

Missing meta description?
→ Code/rule.

Broken link?
→ Code/crawler.

Missing alt text?
→ Code/rule.

What is the likely business impact?
→ AI may help.

How should the issue be explained to a non-technical client?
→ AI may help.

What recommendation should be prioritized given crawl + Search Console context?
→ AI may help.

AI should add reasoning and communication value rather than replace simple validation logic.

AI output must not be treated as factual ground truth when the fact can be verified deterministically.

---

# Findings Model

SEO analysis should conceptually separate:

Raw Observation
→ Finding
→ Opportunity / Impact
→ Recommendation

Where useful, findings may include:

* severity / impact
* confidence
* affected pages
* technical evidence
* plain-language explanation
* recommended next action

Do not invent scoring systems without a clear requirement.

Any SEO health score must be explainable and derived from known rules/data rather than arbitrary AI judgment.

---

# GEO / AI Search Visibility

The original product vision includes GEO — Generative Engine Optimization / AI-search visibility.

This remains part of MARKO's broader Phase 1 vision, but the immediate MVP is currently focused primarily on establishing the SEO analysis/reporting foundation.

Do NOT build broad ChatGPT, Gemini, Perplexity, Copilot, or Google AI Overview monitoring unless explicitly requested.

Architecture should not prevent GEO capabilities from being added later.

---

# Explicitly Deferred From Immediate MVP

Do NOT implement the following unless specifically requested:

* Tier 2 ticket creation
* Jira integration
* Linear integration
* Asana integration
* ClickUp integration
* Trello integration
* JIRITA integration
* Tier 3 automatic fixes
* Developer Agent
* Claude Code automation
* automatic pull requests
* automatic production changes
* WordPress write connector
* Shopify write connector
* Git-based automatic fixes
* client-triggered website modifications
* social media agent
* paid media agent
* content creation agent
* email marketing
* full AI CMO orchestration
* full backlink intelligence platform
* full competitor keyword database
* full SEMrush/Ahrefs replacement
* advanced rank tracking infrastructure
* white labeling unless explicitly requested

These may belong to later phases, but are NOT current implementation requirements.

---

# External Services Principle

Prefer the minimum number of external paid services necessary.

Before introducing a new external provider:

1. verify that the capability cannot reasonably be implemented using existing project infrastructure or first-party APIs;
2. identify why the service is needed;
3. understand pricing/usage implications;
4. do not add the dependency without an explicit implementation need.

Avoid building expensive data pipelines prematurely.

---

# Architecture Principle

The current implementation is SEO-focused, but the long-term MARKO architecture must allow additional marketing agents to share:

* the same client account
* the same users/memberships
* the same site/client data layer where appropriate
* the same integration framework
* the same reporting shell

Do not build Social, Content, Paid Ads, or other agents now.

Only avoid architecture that would make adding them unnecessarily difficult later.

Keep generic platform/account infrastructure separate from SEO-specific domain logic.

---

# Multi-Tenant Requirement

Multi-tenancy is explicitly required by the product brief.

Client data must be isolated.

OAuth integrations must belong to the appropriate client account/site.

Never expose one client's site data, Search Console data, findings, or reports to another client.

Any database-level authorization should default to least privilege.

---

# Security

Treat all client website, integration, OAuth, and analytics data as sensitive business data.

Requirements:

* never expose service-role credentials to the browser
* never store secrets in source control
* use server-side access for privileged operations
* apply database authorization/RLS where appropriate
* validate tenant ownership server-side
* minimize OAuth scopes
* do not log access tokens or secrets
* keep auditability in mind for future regulated clients

Do not weaken security for faster implementation.

---

# Engineering Guidelines

Prefer:

* simple solutions
* clear domain boundaries
* strongly typed code
* deterministic logic
* small reusable modules
* server-side validation
* migrations for database changes
* explicit error handling
* production-realistic data flows

Avoid:

* speculative abstractions
* premature microservices
* excessive dependencies
* fake implementations presented as complete
* duplicated business logic
* giant components
* hardcoded client-specific behavior
* premature optimization
* unnecessary AI calls

---

# Development Workflow

Before implementing any request:

1. inspect the existing code first;
2. understand the current implementation;
3. identify the smallest correct change;
4. preserve existing working behavior;
5. avoid unrelated refactors;
6. implement only the requested scope;
7. run appropriate validation.

When fixing bugs, identify the actual root cause before applying the fix.

Do not paper over errors with UI workarounds when the underlying problem can be fixed correctly.

---

# Validation

For meaningful changes, run the relevant available checks such as:

* lint
* TypeScript/typecheck
* tests when present
* production build where practical

Do not claim something is working unless it was actually validated.

If an external integration cannot be fully validated locally, clearly report what was validated and what still requires manual/external verification.

---

# Git Rules

Unless explicitly requested:

* do NOT commit
* do NOT push
* do NOT create branches
* do NOT modify unrelated files
* do NOT rewrite history

At the end of a task, report changed files and validation results.

---

# Documentation

Maintain `PROJECT_STATUS.md` as the implementation checkpoint for MARKO.

It should reflect:

* current MVP objective
* completed functionality
* current architecture
* known limitations
* deferred scope
* next logical milestone

Do not record speculative features as committed scope.

---

# Current Product Context

The immediate goal is to have a credible MARKO MVP that can be demonstrated with real client/test websites around September 10–15, 2026.

Speed matters, but scope control matters more.

The priority is not feature count.

The priority is demonstrating a real loop:

Website
→ SEO Analysis
→ Findings
→ Opportunities
→ Recommendations
→ Reporting
→ Measurable Improvement

MARKO should become useful before it becomes large.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
