-- A person's own start page: where the app opens when they enter a model.
--
-- Nullable with no default, like capability_map_colour_by: null means "no
-- explicit choice saved", and the application resolves the default from
-- context this table alone doesn't have (the person's role in the
-- organisation: owners and architects start on Home, everyone else on the
-- capability map — src/contracts/userPreferences.ts's resolveStartPage).
-- Table-level grants on user_preferences already cover the new column.

alter table user_preferences
  add column start_page text
    check (start_page in ('home', 'capability-map', 'landscape'));

comment on column user_preferences.start_page is 'Where the app opens when this person enters a model: home (the Overview / My work page), capability-map or landscape. Null means no choice saved yet — the app defaults it from the person''s role (owner/architect: home; everyone else: capability-map), not from a fixed value here.';
