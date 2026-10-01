-- MARKO: AI Visibility — execution method (API vs Browser)
--
-- An AI Visibility run can now acquire the provider's answer two ways:
--   'api'     — the provider's programmatic API (providers/gemini.ts,
--               providers/openai.ts)
--   'browser' — real browser automation of the provider's consumer web
--               experience (providers/geminiBrowser.ts)
-- Both feed the same downstream metrics/persistence, so the method is the
-- experimental variable being compared, not a different methodology.
--
-- Additive only. Every run/result recorded before this migration was
-- produced by a provider API call (browser execution did not exist), so
-- the 'api' default is the correct backfill for existing rows, not a
-- guess. The column is denormalized onto ai_visibility_results the same
-- way provider/model already are, so a result row is self-describing.

alter table public.ai_visibility_runs
  add column if not exists execution_method text not null default 'api'
    check (execution_method in ('api', 'browser'));

alter table public.ai_visibility_results
  add column if not exists execution_method text not null default 'api'
    check (execution_method in ('api', 'browser'));
