-- F7 item 4: model sharing across organisations. Closes SPEC §9's three
-- "pending model_shares" annotations on models_select/commits_select/
-- tags_select (20260906071300_models.sql, 20260906071400_history.sql —
-- each names this migration by exactly this description at the point it
-- deferred). Table shape and both RLS helper functions below are copied
-- from SPEC-data-model.md §3.2/§9 almost verbatim — see this file's own
-- comments for the one place this deviates (the insert/delete role floor,
-- resolved in the F7 plan, not written in the spec).

create table model_shares (
  id uuid primary key,
  model_id uuid not null references models (id) on delete cascade,
  -- Null = "current main"; set = "this version only" (SPEC §3.2's own words).
  tag_id uuid references tags (id),
  shared_with_org_id uuid not null references organisations (id),
  permission text not null default 'view_only' check (permission = 'view_only'),
  expires_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  -- Nulls are never equal to each other in a standard unique constraint —
  -- this already gives SPEC §3.2's own "(nulls distinct)" for free, no
  -- special index needed: two unpinned shares to the same org would still
  -- collide (both tag_id null), which is exactly the "already shared,
  -- don't duplicate" behaviour wanted; two *different* tag-pinned shares
  -- to the same org are legitimately two separate rows.
  unique (model_id, shared_with_org_id, tag_id)
);

comment on table model_shares is 'F7 item 4: a cross-org, read-only grant on a model, optionally pinned to one tag (ADR-009). Never mutated in place once created — revoke (delete) and recreate rather than editing expires_at/tag_id on an existing row.';

create index model_shares_shared_with_org_id_idx on model_shares (shared_with_org_id);
create index model_shares_model_id_idx on model_shares (model_id);

-- A model can never be shared with its own organisation — cross-table, so
-- a plain check constraint can't express it (Postgres check constraints
-- can't subquery another table).
create or replace function atlas.guard_model_share_not_same_org()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from models m where m.id = new.model_id and m.org_id = new.shared_with_org_id) then
    raise exception 'model_shares: cannot share a model with its own organisation' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger model_shares_guard_not_same_org
  before insert or update on model_shares
  for each row execute function atlas.guard_model_share_not_same_org();

-- ---------------------------------------------------------------------------
-- Helper functions (SPEC §9's own literal SQL).
-- ---------------------------------------------------------------------------

create or replace function atlas.model_shared_with_me(p_model uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from model_shares s
    join members m on m.org_id = s.shared_with_org_id and m.user_id = auth.uid()
    where s.model_id = p_model
      and (s.expires_at is null or s.expires_at > now())
  );
$$;

-- True if a specific commit is readable through a share:
--   tag-pinned share  -> only that tag's commit
--   unpinned share    -> any commit on the model's main branch
create or replace function atlas.commit_shared_with_me(p_commit uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from commits c
    join model_shares s on s.model_id = c.model_id
    join members m on m.org_id = s.shared_with_org_id and m.user_id = auth.uid()
    left join tags t on t.id = s.tag_id
    join branches b on b.id = c.branch_id
    where c.id = p_commit
      and (s.expires_at is null or s.expires_at > now())
      and (
        (s.tag_id is null and b.kind = 'main')
        or (s.tag_id is not null and t.commit_id = c.id)
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Extend the three deferred policies. `elements_head`/`relationships_head`/
-- `facts`/`deltas` all read "visible iff its own commits row is"
-- (`exists (select 1 from commits c where c.id = ...)`, `20260906071600_projections.sql`)
-- and inherit this transitively through commits_select's own RLS — no
-- direct change needed there.
-- ---------------------------------------------------------------------------

drop policy models_select on models;
create policy models_select on models
  for select to authenticated
  using (atlas.is_member(org_id) or atlas.model_shared_with_me(id));

drop policy commits_select on commits;
create policy commits_select on commits
  for select to authenticated
  using (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    or (
      atlas.has_role(org_id, 'viewer')
      and (
        atlas.branch_visible_to_viewer(branch_id)
        or exists (select 1 from tags t where t.commit_id = commits.id)
      )
    )
    or atlas.commit_shared_with_me(id)
  );

-- Tags: only a *specifically shared* tag becomes visible cross-org — an
-- unpinned share (main only) never makes every tag on the model visible,
-- matching SPEC §9.5's own "Cross-org visibility of a specifically shared
-- tag" wording exactly (not "every tag once any share exists").
drop policy tags_select on tags;
create policy tags_select on tags
  for select to authenticated
  using (
    atlas.is_member(org_id)
    or exists (
      select 1 from model_shares s
      join members m on m.org_id = s.shared_with_org_id and m.user_id = auth.uid()
      where s.model_id = tags.model_id
        and s.tag_id = tags.id
        and (s.expires_at is null or s.expires_at > now())
    )
  );

-- ---------------------------------------------------------------------------
-- model_shares' own RLS. Select: a member of the model's own (owning) org
-- sees every share on their own models (to manage them); a member of a
-- shared_with org sees only the share(s) extended to their own org, never
-- who else a model is shared with (that's the owning org's business).
-- Insert/delete (create/revoke a share): owner-only of the model's own
-- org — resolved in the F7 plan, not written in SPEC: exposing a model
-- outside the organisation is a bigger, harder-to-undo-safely decision
-- than an ordinary content edit, the same tier as models_delete's
-- existing owner-only bar, not models_update's owner/architect one. No
-- update policy: revoke (delete) and recreate rather than editing a share
-- in place — there is no atomic cross-table effect an RPC would need to
-- add here, so a plain grant is enough, the same "plain grant, no RPC
-- needed" reasoning attribute_definitions' own reorder/deprecate already
-- established.
-- ---------------------------------------------------------------------------

alter table model_shares enable row level security;
alter table model_shares force row level security;

create policy model_shares_select on model_shares
  for select to authenticated
  using (
    exists (select 1 from models m where m.id = model_shares.model_id and atlas.is_member(m.org_id))
    or atlas.is_member(shared_with_org_id)
  );

create policy model_shares_insert on model_shares
  for insert to authenticated
  with check (
    exists (select 1 from models m where m.id = model_shares.model_id and atlas.has_role(m.org_id, 'owner'))
    and created_by = auth.uid()
  );

create policy model_shares_delete on model_shares
  for delete to authenticated
  using (exists (select 1 from models m where m.id = model_shares.model_id and atlas.has_role(m.org_id, 'owner')));

grant select, insert, delete on model_shares to authenticated;

-- ---------------------------------------------------------------------------
-- Resolving a share target by slug. `organisations_select`'s own RLS
-- (`atlas.is_member(id) or created_by = auth.uid()`) means a client can
-- never see any organisation it isn't already a member of — by design,
-- and correctly so for the ordinary case, but it also means an owner
-- creating a share has no way to resolve "the org named by this slug" to
-- an id at all without something that deliberately, narrowly crosses that
-- boundary. This function is that: it returns only `id`/`name` for an org
-- matching a given slug (never membership, content, or anything else),
-- callable by any authenticated user — the real gate is
-- `model_shares_insert`'s own owner-only check, which still applies to
-- whatever id a caller resolves here.
-- ---------------------------------------------------------------------------

create or replace function atlas.resolve_organisation_for_sharing(p_slug text)
returns table(id uuid, name text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select o.id, o.name from organisations o where o.slug = p_slug;
$$;

revoke all on function atlas.resolve_organisation_for_sharing(text) from public;
grant execute on function atlas.resolve_organisation_for_sharing(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Resolving share-target org names for the owner's own management list
-- (`ModelSettingsView`'s "Share with another organisation" panel). Same
-- boundary problem as above, the other direction: `model_shares_select`
-- already lets the owning org see every share row on its own model, but a
-- share row only carries `shared_with_org_id`, and `organisations_select`
-- still blocks resolving that id to a name unless the owner happens to
-- also be a member of the org they shared with. Narrower than the slug
-- lookup above: the ownership check is inline here, not left to a caller
-- downstream, so this returns names only for shares that exist on a model
-- the caller already owns — no id-enumeration surface at all.
-- ---------------------------------------------------------------------------

create or replace function atlas.list_share_target_org_names(p_model_id uuid)
returns table(org_id uuid, org_name text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select distinct s.shared_with_org_id, o.name
  from model_shares s
  join organisations o on o.id = s.shared_with_org_id
  join models m on m.id = s.model_id
  where s.model_id = p_model_id
    and atlas.has_role(m.org_id, 'owner');
$$;

revoke all on function atlas.list_share_target_org_names(uuid) from public;
grant execute on function atlas.list_share_target_org_names(uuid) to authenticated;
