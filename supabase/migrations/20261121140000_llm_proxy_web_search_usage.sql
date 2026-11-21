-- D4: record how many Anthropic web searches a proxy call actually billed.
--
-- The provider reports this in `usage.server_tool_use.web_search_requests`;
-- the proxy already returns it to the caller. Keeping it on the audit row
-- means the per-organisation cost picture is complete: searches are charged
-- at $10 per 1,000 on the organisation's own key, separately from tokens.

alter table public.llm_proxy_requests
  add column web_search_requests integer not null default 0;

comment on column public.llm_proxy_requests.web_search_requests is 'D4: billed provider-side web searches in this call. 0 for calls that did not ask for search.';
