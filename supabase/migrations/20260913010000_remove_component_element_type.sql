-- S1 item 18: "Remove the component level" — ADR-001 amendment
-- (docs/ADR-000-foundations.md), element_type/view_kind taxonomy.
--
-- Refuses to apply if any *live* component element or component-scoped
-- view still exists — that's this model's own current data, not something
-- a schema change should silently discard. Retract any test component
-- elements first, via a real commit (an `element.retract` delta), before
-- re-running this migration; delete any lingering component-scoped
-- `views`/`comments` rows the same way, through the application, not by
-- hand here.
--
-- Deliberately does NOT touch `deltas.element_type`'s own historical
-- values: `deltas` is immutable append-only history (CLAUDE.md rule 5) —
-- a component element created and later retracted, at any point before
-- this migration, leaves a real `element.create` delta permanently
-- recording `element_type = 'component'`, and that fact must stay exactly
-- as it was, never rewritten or erased. Postgres enums can't express
-- "this value is illegal to write from now on, but existing rows may keep
-- it" — a CHECK constraint could, but a plain enum can't — so
-- `deltas.element_type` moves to `text` instead, its taxonomy enforced by
-- `src/contracts/delta.ts` at the point deltas are composed, same
-- code-not-database-CHECK precedent
-- `20260906180000_capability_maps_sector_taxonomy_in_code.sql` already set
-- for the capability-map sector list. `elements_head` (a live projection,
-- rebuilt from `deltas` on every fold, never itself a historical record)
-- and `views`/`comments` (current, no legitimate reason to reference a
-- retired taxonomy value) all get the tightened enum — there's nothing in
-- either worth preserving once component elements are gone from
-- `elements_head`.
--
-- Postgres has no `ALTER TYPE ... DROP VALUE` — the standard workaround
-- (rename the old type, create the new one without the retired value,
-- cast every column across, drop the old type) is what this migration
-- does for both `element_type` and `view_kind`.

do $$
begin
  if exists (select 1 from elements_head where element_type = 'component') then
    raise exception 'cannot remove the component element type: elements_head still has one or more live component elements — retract them first (a real element.retract delta, via a commit), then re-run this migration';
  end if;
  if exists (select 1 from views where kind = 'component') then
    raise exception 'cannot remove the component view kind: views still has one or more component-scoped views — delete them first, through the application';
  end if;
  if exists (select 1 from comments where view_kind = 'component') then
    raise exception 'cannot remove the component view kind: comments still has one or more rows anchored to a component-scoped view — resolve them first, through the application';
  end if;
end $$;

-- deltas.element_type: enum -> text (see this file's own module comment
-- for why this one column doesn't follow the other three below).
alter table deltas alter column element_type type text using element_type::text;

-- element_type: rebuild without 'component'.
alter type element_type rename to element_type_old;
create type element_type as enum ('capability', 'system', 'container', 'actor');
alter table elements_head alter column element_type type element_type using element_type::text::element_type;
drop type element_type_old;

-- view_kind: rebuild without 'component'. views_check references the
-- retired value directly, so it has to go before the column can be cast
-- across, and comes back without 'component' afterwards.
alter table views drop constraint views_check;

alter type view_kind rename to view_kind_old;
create type view_kind as enum ('landscape', 'context', 'container', 'capability_map');
alter table views alter column kind type view_kind using kind::text::view_kind;
alter table comments alter column view_kind type view_kind using view_kind::text::view_kind;
drop type view_kind_old;

alter table views add constraint views_check check ((kind in ('context', 'container')) = (scope_element_id is not null));
