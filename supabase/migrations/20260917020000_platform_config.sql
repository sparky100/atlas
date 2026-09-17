-- E4 follow-up (resolved with the human directly): "LLM settings are
-- controlled at an application level" — matching the existing suite's own
-- `platform_config` pattern exactly, rather than Supabase project secrets
-- alone. `llm-proxy` now reads a `key = 'llm'` row here first (model,
-- rateLimitPerHour, and optionally apiKey — the same per-field fallback
-- shape Des-Studio's own `loadConfig()` uses), falling back to its
-- `LLM_PROXY_MODEL`/`LLM_PROXY_RATE_LIMIT_PER_HOUR`/`ANTHROPIC_API_KEY`
-- env vars field-by-field when this table has no row, or a field is unset
-- on the row it does have. Changing model/rate-limit (or overriding the
-- key) is now an ordinary table update, not a `supabase secrets set` +
-- redeploy.
--
-- No client access at all — enabling RLS with zero policies is itself a
-- deny-all, and the explicit revoke below removes any ambiguity from
-- Supabase's own default per-table grants. A row here can hold a live
-- secret (`llm.apiKey`); the edge function's own service-role key is the
-- only reader or writer, exactly like `llm_proxy_requests`'s own writer,
-- for the same reason.

create table platform_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table platform_config is 'E4 follow-up: application-level configuration overrides (e.g. key=''llm''), read by trusted server-side code only. No RLS policy and no grant to authenticated/anon at all — a row may hold a live secret.';

alter table platform_config enable row level security;
alter table platform_config force row level security;

revoke all on platform_config from authenticated, anon;
