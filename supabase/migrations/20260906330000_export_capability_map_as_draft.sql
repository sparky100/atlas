-- Sprint U4-1 C6: the "Export as starter map" UI action.
--
-- capability_maps/capability_map_items/capability_map_sources have no
-- `authenticated` write grant at all (20260906110000_capability_map_
-- templates.sql's own comment: "writable only by the service role") — a
-- browser session can never insert into them directly, unlike the CLI
-- export (scripts/exportCapabilityMap.ts), which writes a real content
-- file as service_role and is loaded the ordinary way
-- (pnpm content:load-capability-maps). The UI action needs the same
-- privileged write from an authenticated session, so — same shape as
-- atlas.seed_from_map and atlas.commit_deltas — the client computes and
-- validates the export in TypeScript (src/db/exportCapabilityMap.ts's
-- buildCapabilityMapExport, the exact function scripts/
-- exportCapabilityMap.ts also calls, so a UI export and a CLI export of
-- the same model produce identical content) and this function just
-- persists the result, gated to owner/architect (ADR-015).
--
-- Always writes `draft` — never `published` — regardless of what the
-- caller passes, matching the sprint text's own "flagged draft"; only
-- `pnpm content:publish-capability-map` (a human, deliberately, from a
-- real file review) ever moves a map to `published`.
create or replace function atlas.export_capability_map_as_draft(
  p_model_id uuid,
  p_sector text,
  p_version int,
  p_source_description text,
  p_items jsonb,
  p_sources jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_existing_status map_status;
  v_map_id uuid;
begin
  select org_id into v_org_id from models where id = p_model_id;
  if v_org_id is null then
    raise exception 'export_capability_map_as_draft: model % not found', p_model_id using errcode = '22023';
  end if;

  -- Same role gate as atlas.seed_from_map (ADR-015): only owner/architect.
  if atlas.has_role(v_org_id, 'owner', 'architect') is not true then
    raise exception 'export_capability_map_as_draft: only owners and architects may export a capability map' using errcode = '42501';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'export_capability_map_as_draft: a map needs at least one item' using errcode = '22023';
  end if;

  -- A published or deprecated (sector, version) is fixed history
  -- (capability_map_items_guard_immutable would reject the item writes
  -- below anyway) — refuse with a clear reason rather than relying on
  -- that trigger's own generic error. A missing or already-draft row
  -- both proceed: the upsert below creates the first or replaces the
  -- latter wholesale, same "re-exporting a still-draft version refreshes
  -- it" semantics scripts/loadCapabilityMaps.ts already has for a
  -- hand-authored file.
  select status into v_existing_status from capability_maps where sector = p_sector and version = p_version;
  if v_existing_status is not null and v_existing_status <> 'draft' then
    raise exception 'export_capability_map_as_draft: % v% already exists with status %, not draft — export as a new version instead', p_sector, p_version, v_existing_status using errcode = '42501';
  end if;

  insert into capability_maps (id, sector, version, status, source_description, published_at)
  values (gen_random_uuid(), p_sector, p_version, 'draft', p_source_description, null)
  on conflict (sector, version) do update set source_description = excluded.source_description, status = 'draft'
  returning id into v_map_id;

  -- Wholesale replace, not a merge — same reasoning as loadOne's own
  -- comment: a re-export is a fresh, current snapshot of the model, not
  -- something to merge with whatever draft content existed before it.
  delete from capability_map_items where map_id = v_map_id;
  delete from capability_map_sources where map_id = v_map_id;

  -- Parents before children (order by level) so guard_capability_map_item_level
  -- always finds the parent row it needs — items are already level-ordered
  -- by construction (a child never has a lower level than its parent), so
  -- sorting by level alone is sufficient (same comment as loadOne's own).
  insert into capability_map_items (id, map_id, code, parent_code, name, description, level, item_order)
  select gen_random_uuid(), v_map_id, item ->> 'code', item ->> 'parentCode', item ->> 'name', item ->> 'description', (item ->> 'level')::int, (item ->> 'order')::int
  from jsonb_array_elements(p_items) as item
  order by (item ->> 'level')::int;

  if p_sources is not null and jsonb_array_length(p_sources) > 0 then
    insert into capability_map_sources (id, map_id, citation, url, reviewed_by, reviewed_at)
    select gen_random_uuid(), v_map_id, src ->> 'citation', src ->> 'url', src ->> 'reviewedBy', (src ->> 'reviewedAt')::date
    from jsonb_array_elements(p_sources) as src;
  end if;

  return v_map_id;
end;
$$;

revoke all on function atlas.export_capability_map_as_draft from public;
grant execute on function atlas.export_capability_map_as_draft to authenticated;
