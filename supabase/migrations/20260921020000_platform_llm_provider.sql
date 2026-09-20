-- Platform admin follow-up (resolved with the human directly): the LLM
-- proxy's own settings should carry a `provider` field alongside `model`,
-- even though `llm-proxy`'s own routing (`supabase/functions/llm-proxy/index.ts`)
-- calls Anthropic only, by ADR-014's own deliberate scope narrowing. The
-- principle behind this change, not just this one field: this config
-- shouldn't be *shaped* around one provider only to need a schema change
-- the day a second one is actually wired up — see ADR-000-foundations.md's
-- ADR-014 amendment below this migration's own commit for the fuller
-- reasoning. This migration adds the storage and the validated RPC surface
-- only; it does not add OpenAI/any second provider's actual request
-- routing, which stays exactly as out of scope as ADR-014 already says.
--
-- `p_provider` is checked against a fixed one-value allow-list
-- (`'anthropic'`) rather than accepted freely — the honest state today is
-- still "one real provider," and a client-supplied arbitrary string here
-- would silently be stored and then ignored by `llm-proxy`'s own
-- Anthropic-only `callAnthropic`, which is worse than refusing it
-- outright. Extending that allow-list is the whole cost of adding a
-- second provider's config surface later; no further migration needed for
-- the column/field itself.
--
-- Both RPCs' argument/return lists change (`get_platform_llm_config` gains
-- a new output column; `set_platform_llm_config` gains a new input
-- parameter), so both need `drop function` first — `create or replace`
-- cannot change a function's parameter or OUT-column list (same rule
-- `20260906270000_commit_titles.sql` and `20260906161000_merge_review_queue.sql`
-- already document for this schema; a drop wipes grants, restated below).

drop function if exists atlas.get_platform_llm_config();

create function atlas.get_platform_llm_config()
returns table (provider text, model text, rate_limit_per_hour integer, has_api_key boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_value jsonb;
begin
  if not atlas.is_platform_admin() then
    raise exception 'get_platform_llm_config: platform admin only' using errcode = '42501';
  end if;

  select pc.value into v_value from platform_config pc where pc.key = 'llm';

  return query select
    -- No override row yet, or a row written before this migration, both
    -- read as the one real provider today — not null, since "no provider
    -- configured" isn't a real state `llm-proxy` can be in.
    coalesce(v_value ->> 'provider', 'anthropic'),
    v_value ->> 'model',
    nullif(v_value ->> 'rateLimitPerHour', '')::integer,
    coalesce(v_value ->> 'apiKey', '') <> '';
end;
$$;

drop function if exists atlas.set_platform_llm_config(text, integer, text, boolean);

create function atlas.set_platform_llm_config(
  p_model text,
  p_rate_limit_per_hour integer,
  p_provider text default 'anthropic',
  p_api_key text default null,
  p_clear_api_key boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing jsonb;
  v_next jsonb;
begin
  if not atlas.is_platform_admin() then
    raise exception 'set_platform_llm_config: platform admin only' using errcode = '42501';
  end if;
  if p_model is null or btrim(p_model) = '' then
    raise exception 'set_platform_llm_config: model is required' using errcode = '22023';
  end if;
  if p_rate_limit_per_hour is null or p_rate_limit_per_hour <= 0 then
    raise exception 'set_platform_llm_config: rateLimitPerHour must be a positive integer' using errcode = '22023';
  end if;
  if p_provider is distinct from 'anthropic' then
    raise exception 'set_platform_llm_config: unsupported provider % (llm-proxy is Anthropic-only)', p_provider using errcode = '22023';
  end if;

  select pc.value into v_existing from platform_config pc where pc.key = 'llm';
  v_next := jsonb_build_object('provider', p_provider, 'model', p_model, 'rateLimitPerHour', p_rate_limit_per_hour);

  if p_clear_api_key then
    null; -- omit apiKey entirely -- llm-proxy's own loadConfig falls back to ANTHROPIC_API_KEY
  elsif p_api_key is not null and btrim(p_api_key) <> '' then
    v_next := v_next || jsonb_build_object('apiKey', p_api_key);
  elsif v_existing ? 'apiKey' then
    v_next := v_next || jsonb_build_object('apiKey', v_existing ->> 'apiKey'); -- untouched, kept as-is
  end if;

  insert into platform_config (key, value, updated_at)
  values ('llm', v_next, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

revoke all on function atlas.get_platform_llm_config() from public;
revoke all on function atlas.set_platform_llm_config(text, integer, text, text, boolean) from public;
grant execute on function atlas.get_platform_llm_config() to authenticated;
grant execute on function atlas.set_platform_llm_config(text, integer, text, text, boolean) to authenticated;
