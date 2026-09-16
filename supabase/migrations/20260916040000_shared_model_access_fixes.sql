-- F7 item 4 follow-up: two real gaps found while exercising the golden
-- path end to end (PR7), both in code the previous migration
-- (20260916020000_model_shares.sql) shipped, not new scope.
--
-- 1. organisations_select never gained a model_shares-aware clause. Every
--    read that names the *owning* organisation by id — `listModelsSharedWithOrg`'s
--    own second query (OrgHome's "Shared with us" section) most directly —
--    silently drops every row it can't also resolve an owner org for,
--    because `organisations_select`'s RLS (`is_member(id) or created_by =
--    auth.uid()`) has no idea a share exists. Without this, "Shared with
--    us" would render nothing at all for anyone not separately a member of
--    the owning org — the exact audience this feature is for.
--
-- 2. A shared-with viewer had no RLS path to the *current* head commit of
--    an unpinned ("current main") share at all. `models_select`/
--    `commits_select`/`tags_select` (the previous migration) all key off
--    an already-known id; `branches` — the one table that actually stores
--    a commit id, indeed `atlas.model_shared_with_me`/`commit_shared_with_me`
--    themselves never touch it — is untouched, member-scoped-only RLS
--    (SPEC §9.5's own "member-scoped" template). A tag-pinned share never
--    hit this (the pinned tag's own `commit_id` is already visible via
--    `tags_select`'s new clause), but an unpinned share had no way to
--    discover "what commit is main currently at" short of enumerating every
--    commit `commits_select` already lets through and walking parent
--    pointers — real, but not how any existing code (`getMainBranch`) ever
--    resolves this, and not a reasonable thing to ask the client to do.
--
--    Resolved with a narrow RPC rather than widening `branches_select`
--    itself (branches stays exactly as invisible to a non-member as it was
--    — no new reachable surface on that table for anything else, change
--    branches included): `atlas.get_shared_main_branch` returns the real
--    main-branch row, but only when the caller holds a share with
--    `tag_id is null` specifically — a tag-pinned share must never see
--    main's live head move out from under the version it pinned.
--    `src/db/branches.ts`'s `getMainBranch` calls this only as a fallback,
--    once the plain RLS-gated read already came back empty — every
--    existing caller of `getMainBranch` (`useMainBranch`, `resolveRef`'s
--    own `main` case, and everything built on either) benefits without
--    its own code change.

create or replace function atlas.org_shares_a_model_with_me(p_owner_org uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from model_shares s
    join models m on m.id = s.model_id and m.org_id = p_owner_org
    join members mm on mm.org_id = s.shared_with_org_id and mm.user_id = auth.uid()
    where (s.expires_at is null or s.expires_at > now())
  );
$$;

drop policy organisations_select on organisations;
create policy organisations_select on organisations
  for select to authenticated
  using (atlas.is_member(id) or created_by = auth.uid() or atlas.org_shares_a_model_with_me(id));

create or replace function atlas.get_shared_main_branch(p_model_id uuid)
returns setof branches
language sql stable security definer
set search_path = public, pg_temp
as $$
  select b.*
  from branches b
  where b.model_id = p_model_id
    and b.kind = 'main'
    and exists (
      select 1
      from model_shares s
      join members m on m.org_id = s.shared_with_org_id and m.user_id = auth.uid()
      where s.model_id = p_model_id
        and s.tag_id is null
        and (s.expires_at is null or s.expires_at > now())
    );
$$;

revoke all on function atlas.get_shared_main_branch(uuid) from public;
grant execute on function atlas.get_shared_main_branch(uuid) to authenticated;
