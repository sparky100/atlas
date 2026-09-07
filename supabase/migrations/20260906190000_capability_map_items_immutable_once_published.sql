-- Once a capability map is published, its items are immutable — the
-- versioning model ADR-012/SPEC §3.10 already assumes ("a versioned
-- sector starter map") only works if "published" actually means fixed.
-- Without this, scripts/loadCapabilityMaps.ts's own wholesale
-- delete-then-reinsert (re-running the loader against an edited content
-- file at the same sector/version) would silently rewrite a map every
-- consumer has already cited or tailored a model from. The fix for
-- wanting to change a published map's content is a new version, not an
-- edit — scripts/publishCapabilityMap.ts is the only thing that ever
-- moves a map from draft to published, and nothing moves it back.
--
-- Same guard shape as atlas.guard_capability_map_item_level (this table's
-- own sibling trigger, 20260906110000_capability_map_templates.sql):
-- enforced in the database so it holds regardless of which future tool
-- writes these rows, not just the loader as it exists today.

create or replace function atlas.guard_capability_map_item_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_map_id uuid := coalesce(new.map_id, old.map_id);
  v_status map_status;
begin
  select status into v_status from capability_maps where id = v_map_id;
  if v_status = 'published' then
    raise exception 'capability_map_items: map % is published and immutable — publish a new version instead of editing this one', v_map_id using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger capability_map_items_guard_immutable
  before insert or update or delete on capability_map_items
  for each row execute function atlas.guard_capability_map_item_immutable();

comment on function atlas.guard_capability_map_item_immutable is 'Rejects any insert/update/delete on capability_map_items whose map is already published (SPEC §3.10) — a published map is fixed; changing its content means publishing a new version.';
