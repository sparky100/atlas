-- Phase D step 3 (Simon, 2026-11-19): record which key paid for each AI call, so
-- an organisation's own-key use (agents) can be told apart from platform-key use
-- (Ask Atlas, capture, help).
--
-- One column on an existing table, nothing else:
--   * 'app' = the platform key (every row written before today, and every call
--     that is not an agent call);
--   * 'org' = the organisation's own key (`useOrgKey`).
-- No new table, function, grant or policy. `llm_proxy_requests` already has RLS
-- enabled with a member-only select policy and no insert/update/delete grant for
-- signed-in users; the `llm-proxy` edge function writes it with the service role.
-- Still never holds a prompt or an answer.

alter table llm_proxy_requests
  add column key_source text not null default 'app'
  check (key_source in ('app', 'org'));
