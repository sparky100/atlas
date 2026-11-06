-- F15 (ADR-028 §7): sending model content to the AI provider is off by
-- default and switched on by an organisation owner. One column, one grant.
-- `organisations_update` (owner only, RLS) is the permission; the column
-- grant keeps this the only extra thing an update can touch.
alter table organisations add column ai_assistant_enabled boolean not null default false;

grant update (ai_assistant_enabled) on organisations to authenticated;
