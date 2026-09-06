-- Sprint U1 step 2a: user_preferences (SPEC-data-model.md §3.2,
-- UI-principles.md §3 / §10 decision 1).
--
-- Keyed on the user, not the membership: preferences follow a person
-- across organisations, unlike everything else in this schema (S-20's
-- org_id convention explicitly excludes this table and `organisations`
-- itself). No org_id, no per-org row.

create table user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  home_mode text not null default 'director' check (home_mode in ('director', 'architect')),
  density text not null default 'comfortable' check (density in ('comfortable', 'compact')),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  updated_at timestamptz not null default now()
);

comment on table user_preferences is 'Per-person UI preferences: home door, density, theme (SPEC §3.2). Not org-scoped.';

create trigger user_preferences_touch_updated_at
  before update on user_preferences
  for each row execute function atlas.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: user-scoped, not org-scoped — the only table besides `organisations`
-- without an org_id-based policy (SPEC §9).
-- ---------------------------------------------------------------------------

alter table user_preferences enable row level security;
alter table user_preferences force row level security;

create policy user_preferences_select on user_preferences
  for select to authenticated
  using (user_id = auth.uid());

create policy user_preferences_insert on user_preferences
  for insert to authenticated
  with check (user_id = auth.uid());

create policy user_preferences_update on user_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No delete policy: "a row is reset, not removed" (SPEC §3.2) — a client
-- restores defaults with an update, never a delete.

grant select, insert, update on user_preferences to authenticated;
