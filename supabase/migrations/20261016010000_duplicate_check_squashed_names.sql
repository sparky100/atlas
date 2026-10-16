-- Duplicates report fix (2026-10-16; ADR-000's "Amended (F4, ...)" item 2,
-- amended): the trigram gate also compares *squashed* names — lower case,
-- every non-alphanumeric character removed — so a spacing, hyphen or case
-- variant of the same name ("PowerON" / "Power On" / "Power-On") is
-- flagged. pg_trgm splits a string into words at every non-alphanumeric
-- run, so "power on" and "poweron" share only 6 of 11 trigrams (0.545),
-- under the 0.6 threshold: the report could never flag the most common
-- kind of duplicate. The threshold itself (0.6) is unchanged, and so is
-- everything else in atlas.run_duplicate_check — this replaces it whole
-- with only the name_similarity expression and the gate widened.

-- Immutable (index-safe): lower() and regexp_replace() over the argument alone.
create or replace function atlas.squash_name(p_name text)
returns text
language sql immutable parallel safe
as $$
  select pg_catalog.regexp_replace(pg_catalog.lower(p_name), '[^[:alnum:]]+', '', 'g');
$$;

revoke all on function atlas.squash_name(text) from public;
grant execute on function atlas.squash_name(text) to authenticated;

-- The squashed twin of elements_head_name_trgm_idx (20260906071600_projections.sql),
-- so the `%` gate on squashed names can seek rather than scan every pair.
create index elements_head_squashed_name_trgm_idx on elements_head using gin (atlas.squash_name(name) gin_trgm_ops);

create or replace function atlas.run_duplicate_check(p_model_id uuid)
returns duplicate_check_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_caller uuid := auth.uid();
  v_head_commit_id uuid;
  v_run_id uuid := gen_random_uuid();
  v_run duplicate_check_runs;
  v_candidate_count int := 0;
begin
  select org_id into v_org_id from models where id = p_model_id;
  if v_org_id is null then
    raise exception 'run_duplicate_check: model % not found', p_model_id using errcode = '22023';
  end if;

  if v_caller is not null and not atlas.has_role(v_org_id, 'owner', 'architect', 'contributor') then
    raise exception 'run_duplicate_check: insufficient role on org %', v_org_id using errcode = '42501';
  end if;

  -- Reap a stuck run (a crashed backend, a hard statement timeout) rather
  -- than let it block this model's own checks forever — the exception
  -- handler at the bottom of this function already turns an ordinary
  -- failure into status = 'failed', so a row still stuck at 'running' this
  -- long almost certainly never got the chance to run that handler at all.
  update duplicate_check_runs
  set status = 'failed', error = 'timed out (no completion within 10 minutes)', finished_at = now()
  where model_id = p_model_id and status = 'running' and created_at <= now() - interval '10 minutes';

  begin
    insert into duplicate_check_runs (id, org_id, model_id, triggered_by, status)
    values (v_run_id, v_org_id, p_model_id, v_caller, 'running');
  exception when unique_violation then
    raise exception 'run_duplicate_check: a check is already running for model %', p_model_id;
  end;

  begin
    select b.head_commit_id into v_head_commit_id from branches b where b.model_id = p_model_id and b.kind = 'main';

    if v_head_commit_id is not null then
      -- IDENTITY_TRIGRAM_THRESHOLD (src/engine/trigram.ts, SPEC §8 point 3)
      -- — the same 0.6 the in-memory engine matcher already uses.
      -- Transaction-local (this call's own execution only). It's the `%`
      -- operator below, not a bare similarity() predicate, that lets the
      -- e1/e2 self-join use elements_head_name_trgm_idx
      -- (20260906071600_projections.sql) — a function-call predicate would
      -- give the planner nothing to seek on.
      set local pg_trgm.similarity_threshold = 0.6;

      with els_alias as (
        select a.element_id, a.alias_value
        from aliases a
        where a.model_id = p_model_id and a.alias_type = 'name'
      ),
      pairs as (
        select
          e1.element_id as element_a_id,
          e2.element_id as element_b_id,
          e1.element_type,
          -- Best of name<->name, name<->alias, alias<->name, alias<->alias
          -- — ADR-019's own "report what search missed" names the alias
          -- table (the same one ElementSearchAdd's own search consults)
          -- explicitly, not just an element's current name.
          -- ADR-026 follow-up (duplicates fix, 2026-10-16): each comparison
          -- is also made on the squashed form (atlas.squash_name: lower
          -- case, every non-alphanumeric removed), so "PowerON"/"Power On"/
          -- "Power-On" score 1.0 instead of 0.545 — pg_trgm splits words at
          -- spaces, so a spacing variant alone fell under the 0.6 gate.
          greatest(
            similarity(lower(e1.name), lower(e2.name)),
            similarity(atlas.squash_name(e1.name), atlas.squash_name(e2.name)),
            coalesce((select max(greatest(similarity(lower(e1.name), lower(a2.alias_value)), similarity(atlas.squash_name(e1.name), atlas.squash_name(a2.alias_value)))) from els_alias a2 where a2.element_id = e2.element_id), 0),
            coalesce((select max(greatest(similarity(lower(a1.alias_value), lower(e2.name)), similarity(atlas.squash_name(a1.alias_value), atlas.squash_name(e2.name)))) from els_alias a1 where a1.element_id = e1.element_id), 0),
            coalesce((select max(greatest(similarity(lower(a1.alias_value), lower(a2.alias_value)), similarity(atlas.squash_name(a1.alias_value), atlas.squash_name(a2.alias_value)))) from els_alias a1 join els_alias a2 on a2.element_id = e2.element_id where a1.element_id = e1.element_id), 0)
          ) as name_similarity,
          -- identityContextCorroborates (src/engine/merge.ts) reimplemented
          -- here in SQL rather than a second, hand-written version of the
          -- same rule: same parent (meaningful for a container; a system
          -- has none worth comparing, SPEC §8), same non-empty vendor,
          -- same non-empty description.
          (e1.parent_id is not null and e1.parent_id = e2.parent_id) as shared_parent,
          (nullif(lower(trim(e1.attributes ->> 'vendor')), '') is not null and lower(trim(e1.attributes ->> 'vendor')) = lower(trim(e2.attributes ->> 'vendor'))) as shared_vendor,
          (nullif(lower(trim(e1.attributes ->> 'description')), '') is not null and lower(trim(e1.attributes ->> 'description')) = lower(trim(e2.attributes ->> 'description'))) as shared_description
        from elements_head e1
        join elements_head e2
          on e2.commit_id = e1.commit_id
         and e2.model_id = e1.model_id
         and e2.element_type = e1.element_type
         and e2.element_id > e1.element_id
        where e1.commit_id = v_head_commit_id
          and e1.model_id = p_model_id
          -- v1 scope: system/container only (ADR-000's "Amended (F4, ...)"
          -- item 2) — capability/actor duplication is a different,
          -- lower-value conversation this build doesn't take on.
          and e1.element_type in ('system', 'container')
          and (
            lower(e1.name) % lower(e2.name)
            -- elements_head_squashed_name_trgm_idx (below) is what lets this one seek, as elements_head_name_trgm_idx does for the line above.
            or atlas.squash_name(e1.name) % atlas.squash_name(e2.name)
            or exists (select 1 from els_alias a2 where a2.element_id = e2.element_id and (lower(e1.name) % lower(a2.alias_value) or atlas.squash_name(e1.name) % atlas.squash_name(a2.alias_value)))
            or exists (select 1 from els_alias a1 where a1.element_id = e1.element_id and (lower(a1.alias_value) % lower(e2.name) or atlas.squash_name(a1.alias_value) % atlas.squash_name(e2.name)))
            or exists (
              select 1 from els_alias a1 join els_alias a2 on a2.element_id = e2.element_id
              where a1.element_id = e1.element_id and (lower(a1.alias_value) % lower(a2.alias_value) or atlas.squash_name(a1.alias_value) % atlas.squash_name(a2.alias_value))
            )
          )
      ),
      -- identityContextCorroborates's fourth signal, "a shared owning
      -- actor" (ownerActorIds, src/engine/merge.ts) — an owns edge, any
      -- role, from the same actor into both sides.
      owners as (
        select from_element_id as owner_id, to_element_id as element_id
        from relationships_head
        where commit_id = v_head_commit_id and model_id = p_model_id and relationship_type = 'owns'
      ),
      -- The third element every uses/flows_to/supports edge touches,
      -- either direction — "overlapping relationships" (ADR-019's own
      -- wording for this signal).
      neighbours as (
        select from_element_id as element_id, to_element_id as neighbour_id
        from relationships_head
        where commit_id = v_head_commit_id and model_id = p_model_id and relationship_type in ('uses', 'flows_to', 'supports')
        union all
        select to_element_id as element_id, from_element_id as neighbour_id
        from relationships_head
        where commit_id = v_head_commit_id and model_id = p_model_id and relationship_type in ('uses', 'flows_to', 'supports')
      ),
      qualifying as (
        select
          p.*,
          exists (
            select 1 from owners oa join owners ob on oa.owner_id = ob.owner_id
            where oa.element_id = p.element_a_id and ob.element_id = p.element_b_id
          ) as shared_owner,
          (
            select count(distinct na.neighbour_id)
            from neighbours na
            join neighbours nb on nb.neighbour_id = na.neighbour_id
            where na.element_id = p.element_a_id and nb.element_id = p.element_b_id
          ) as neighbour_overlap_count
        from pairs p
        -- The trigram gate is what lets a pair appear at all — the
        -- corroborating signals above only ever affect score/badges, never
        -- eligibility (ADR-000's "Amended (F4, ...)" item 2).
        where p.name_similarity >= 0.6
          and not exists (
            select 1 from duplicate_dismissals d
            where d.model_id = p_model_id and d.element_a_id = p.element_a_id and d.element_b_id = p.element_b_id
          )
      )
      insert into duplicate_candidates (id, org_id, model_id, element_a_id, element_b_id, element_type, score, name_similarity, signals, last_seen_check_run_id, updated_at)
      select
        gen_random_uuid(),
        v_org_id,
        p_model_id,
        q.element_a_id,
        q.element_b_id,
        q.element_type,
        -- Explicitly tunable and documented, not derived science — the
        -- same posture E7's own prompt already took for its own
        -- thresholds ("thresholds documented").
        least(
          1.0,
          0.60 * q.name_similarity
          + 0.15 * q.shared_owner::int
          + 0.10 * (q.shared_vendor or q.shared_parent)::int
          + 0.05 * q.shared_description::int
          + 0.10 * (least(q.neighbour_overlap_count, 3)::numeric / 3.0)
        ),
        q.name_similarity,
        jsonb_build_object(
          'sharedOwner', q.shared_owner,
          'sharedVendor', q.shared_vendor,
          'sharedParent', q.shared_parent,
          'sharedDescription', q.shared_description,
          'neighbourOverlapCount', q.neighbour_overlap_count
        ),
        v_run_id,
        now()
      from qualifying q
      on conflict (model_id, element_a_id, element_b_id) do update set
        score = excluded.score,
        name_similarity = excluded.name_similarity,
        signals = excluded.signals,
        last_seen_check_run_id = excluded.last_seen_check_run_id,
        updated_at = now();

      -- Prune: a pair not re-confirmed by this run no longer qualifies
      -- (edited apart since, or one side changed) — deleted outright, not
      -- left stale for the report to filter around.
      delete from duplicate_candidates
      where model_id = p_model_id and last_seen_check_run_id <> v_run_id;

      select count(*) into v_candidate_count from duplicate_candidates where model_id = p_model_id;
    end if;

    update duplicate_check_runs
    set status = 'succeeded', candidate_count = v_candidate_count, finished_at = now()
    where id = v_run_id
    returning * into v_run;

    return v_run;
  exception when others then
    update duplicate_check_runs set status = 'failed', error = sqlerrm, finished_at = now() where id = v_run_id;
    raise;
  end;
end;
$$;

revoke all on function atlas.run_duplicate_check(uuid) from public;
grant execute on function atlas.run_duplicate_check(uuid) to authenticated;
