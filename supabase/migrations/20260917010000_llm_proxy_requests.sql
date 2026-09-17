-- E4 (docs/prompts/atlas-prompt-pack.md): the shared LLM proxy edge
-- function (ADR-014's own "extract this immediately" recommendation).
-- `llm_proxy_requests` is this migration's own contribution: a per-org
-- request log the edge function writes to for two things E4's own text
-- asks for — "per-org rate limits" (computed by counting this table's own
-- rows in the last hour, no separate counter needed) and "request logging
-- without payload retention" (this table has no prompt/response column at
-- all, deliberately — see the table comment).
--
-- Append-only, like every other audit-shaped table in this schema
-- (`member_events`, `resolved_conflicts`): no insert/update/delete grant to
-- `authenticated` at all. The edge function is the only writer, using the
-- service-role key (unlike `send-invite-email`, which deliberately holds
-- none — see that function's own module comment; this one needs the
-- service role specifically to write this log, since nothing in this
-- schema lets an ordinary member insert their own audit rows).

create table llm_proxy_requests (
  id uuid primary key,
  org_id uuid not null references organisations (id) on delete cascade,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  status text not null check (status in ('ok', 'error', 'rate_limited')),
  latency_ms integer,
  created_at timestamptz not null default now()
);

comment on table llm_proxy_requests is 'E4: a per-org LLM proxy call log — provider auth, rate limiting and audit, never the prompt/response content itself (no payload retention, by design). Written only by the llm-proxy edge function via the service-role key; member-scoped select.';

create index llm_proxy_requests_org_id_created_at_idx on llm_proxy_requests (org_id, created_at desc);

alter table llm_proxy_requests enable row level security;
alter table llm_proxy_requests force row level security;

create policy llm_proxy_requests_select on llm_proxy_requests
  for select to authenticated
  using (atlas.is_member(org_id));

grant select on llm_proxy_requests to authenticated;
