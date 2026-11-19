-- Simon, 2026-11-19: cost data is never shared with an AI unless the
-- organisation chooses to. One column, one grant, mirroring
-- `ai_assistant_enabled` (20261107010000): `organisations_update` (owner
-- only, RLS) is the permission; the column grant keeps this the only extra
-- thing an update can touch. Off by default, so every existing organisation
-- stops sending run cost to the AI provider until an owner opts in.
alter table organisations add column ai_share_run_cost boolean not null default false;

grant update (ai_share_run_cost) on organisations to authenticated;
