-- Designer free trial (Simon, 2026-11-20): an organisation with agents switched on but
-- no AI key of its own can run the Designer a few times on the platform key, so people
-- can try it before an owner sets up billing. Everything else about agents is unchanged
-- (own key once saved; never a fallback to the platform key for an organisation that
-- has used its allowance).
--
-- Two changes to one existing table, nothing else:
--   * key_source also allows 'trial' (platform key, counted against the allowance);
--   * run_id (nullable uuid): the Designer's id for one run, so "5 runs" counts runs
--     rather than the several model calls one run makes. Written only by the llm-proxy
--     edge function with the service role. Holds no prompt, answer or money figure.
-- No new table, function, grant, policy or index. `llm_proxy_requests` already has RLS
-- on with a member-only select policy and no insert/update/delete grant for signed-in
-- users, so who can see or change what is unchanged. Members can read their own
-- organisation's rows (counts only), which is how the page shows runs left.

alter table llm_proxy_requests drop constraint if exists llm_proxy_requests_key_source_check;
alter table llm_proxy_requests
  add constraint llm_proxy_requests_key_source_check
  check (key_source in ('app', 'org', 'trial'));

alter table llm_proxy_requests add column run_id uuid;
