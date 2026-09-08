-- Sprint M1a step 2: comments, replies, resolution, @mentions, and their
-- notification records (ADR-010 amendment, SPEC §3.8/§9.4 amendment).
--
-- This supersedes the `comments` column list and `anchor_type` enum values
-- SPEC-data-model.md originally drafted (visibility team/internal, view_id +
-- hint_x/hint_y, anchor_type element/relationship/delta/branch/decision).
-- What ships here instead: `branch_id` + `view_kind` replace `view_id` +
-- hint_x/hint_y (no per-view pin coordinate this iteration — a comment
-- still optionally names *which kind* of view it was raised from, not a
-- point on one); `visibility` (team/internal) is dropped entirely, deferred
-- until a real product need for an internal-only comment shows up;
-- anchor_type's five values become element/relationship/change/decision/
-- version — `change` anchors directly to a branch (`branch_id` on the
-- comment row is separate: it records which branch context a comment on an
-- element/relationship was made from, for viewer-visibility purposes, even
-- when the anchor itself is the element, not the branch); `version` anchors
-- to a `tags` row, this product's "version" (tags.comment on that table).
--
-- Anchors are always a stable subject id (an element_id, relationship_id,
-- branch/tag id) — never a commit id. That is what makes "comment survives
-- merge" and "comment survives refresh" free: ADR-002/008 already guarantee
-- element_id/relationship_id never change identity across either operation,
-- so a comment anchored to one is unaffected by both, with zero re-anchoring
-- logic (see RT-8 below and this migration's own round-trip tests).

create type anchor_type as enum ('element', 'relationship', 'change', 'decision', 'version');
create type comment_status as enum ('open', 'resolved');

create table comments (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  anchor_type anchor_type not null,
  anchor_id uuid not null,
  -- Which branch this comment was raised from — null for a main/tag-scoped
  -- anchor (element/relationship visible on main, or a `change`/`version`
  -- anchor, which already names its own branch/tag as anchor_id). Set when
  -- the anchor (typically an element or relationship) only exists on a
  -- draft change branch, so viewer-visibility can gate on the branch
  -- without elements_head ever needing to record "which branch" itself.
  branch_id uuid references branches (id),
  view_kind view_kind,
  parent_comment_id uuid references comments (id),
  body text not null check (length(btrim(body)) > 0),
  author_id uuid not null references auth.users (id),
  status comment_status not null default 'open',
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  -- Only a thread's root carries resolution state (ADR-010's flat reply
  -- chain: replies don't resolve independently of their thread).
  constraint comments_resolution_only_on_root check (parent_comment_id is null or (status = 'open' and resolved_by is null and resolved_at is null)),
  constraint comments_resolution_consistent check ((status = 'resolved') = (resolved_by is not null and resolved_at is not null))
);

comment on table comments is 'Threaded comments anchored to a model object (ADR-010 amendment, SPEC §3.8 amendment, S-16). Anchors are stable subject ids, never commit ids.';

create index comments_model_anchor_idx on comments (model_id, anchor_type, anchor_id);
create index comments_parent_idx on comments (parent_comment_id);
create index comments_org_id_idx on comments (org_id);
create index comments_branch_id_idx on comments (branch_id) where branch_id is not null;

-- Full row images on UPDATE (resolve/reopen, body edits) so a realtime
-- subscriber gets the old and new values in one payload, not just the new.
alter table comments replica identity full;

-- ---------------------------------------------------------------------------
-- comment_mentions: who an @handle in a comment's body resolved to.
-- ---------------------------------------------------------------------------

create table comment_mentions (
  comment_id uuid not null references comments (id) on delete cascade,
  org_id uuid not null references organisations (id),
  user_id uuid not null references auth.users (id),
  primary key (comment_id, user_id)
);

comment on table comment_mentions is 'Who an @handle in a comment''s body resolved to (Sprint M1a) — written only by atlas.process_comment_mentions, parsed from the body at insert time against atlas.profiles.handle, restricted to the comment''s own org.';

create index comment_mentions_user_id_idx on comment_mentions (user_id);

-- ---------------------------------------------------------------------------
-- notifications: one row per mentioned member per comment. In-app only, no
-- email delivery (Sprint M1a's explicit scope).
-- ---------------------------------------------------------------------------

create type notification_kind as enum ('mention');

create table notifications (
  id uuid primary key,
  -- Not in Sprint M1a's literal column list (which named only id, user_id,
  -- kind, comment_id, read_at, created_at) — added per SPEC §2's universal
  -- "every table gets org_id" rule (organisations/user_preferences are the
  -- only two named exceptions), and needed here regardless for RLS's
  -- atlas.is_member(org_id) gate.
  org_id uuid not null references organisations (id),
  user_id uuid not null references auth.users (id),
  kind notification_kind not null,
  comment_id uuid references comments (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table notifications is 'An in-app notification for one member (Sprint M1a) — today, only comment @mentions; written only by atlas.process_comment_mentions. No email delivery; SPEC §11 defers a notification tray UI to U4 — this sprint ships the record and an unread count only.';

create index notifications_user_id_read_at_idx on notifications (user_id, read_at);

alter table notifications replica identity full;

-- ---------------------------------------------------------------------------
-- atlas.anchor_visible_to_viewer: true if a viewer-role member may see the
-- object a comment is anchored to. Rewritten for this migration's anchor_type
-- values (element/relationship/change/decision/version) — no prior version
-- of this function was ever migrated (SPEC-data-model.md's own draft of it,
-- §9's helper section, used the original delta/branch-named enum, which
-- never shipped).
-- ---------------------------------------------------------------------------

create or replace function atlas.anchor_visible_to_viewer(p_type anchor_type, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p_type
    -- Decisions aren't a migrated table yet (SPEC §11, deferred); a comment
    -- anchored to one is universally visible until that table exists to
    -- carry its own visibility rule.
    when 'decision' then true
    when 'change'   then atlas.branch_visible_to_viewer(p_id)
    when 'version'  then exists (select 1 from tags where id = p_id)
    when 'element'  then exists (
                      select 1 from elements_head eh join branches b on b.head_commit_id = eh.commit_id
                      where eh.element_id = p_id and (b.kind = 'main' or b.shared_for_review))
    when 'relationship' then exists (
                      select 1 from relationships_head rh join branches b on b.head_commit_id = rh.commit_id
                      where rh.relationship_id = p_id and (b.kind = 'main' or b.shared_for_review))
  end;
$$;

revoke all on function atlas.anchor_visible_to_viewer(anchor_type, uuid) from public;
grant execute on function atlas.anchor_visible_to_viewer(anchor_type, uuid) to authenticated;

-- One predicate, reused by comments' own SELECT policy and by
-- comment_mentions' (which has no anchor of its own — it joins back to its
-- comment). Contributor+ see every comment in their org unconditionally,
-- same as commits/deltas/views already do; a viewer needs the anchor
-- itself visible to them (`atlas.anchor_visible_to_viewer` already covers
-- "branch-anchored comments visible to whoever can see the branch, viewers
-- only when shared_for_review" in full: a `change` anchor calls
-- `atlas.branch_visible_to_viewer` directly, and an `element`/`relationship`
-- anchor only resolves true when *some* branch containing it is main or
-- shared_for_review).
--
-- `comments.branch_id` deliberately does not gate this predicate, even
-- though it looks like the natural place for "which branch was this raised
-- on" to matter: it names the branch a comment was posted *from*, which
-- stays pinned to that original draft branch forever (SPEC §2's normal
-- immutable-history convention) even after the branch merges and the
-- anchor itself becomes visible on main. Gating on it in addition to the
-- anchor would leave a merged element's comments permanently invisible to
-- viewers — wrong, since the whole point of ADR-010's "anchors are stable
-- subject ids" is that visibility should track the anchor's own current
-- state, not the historical accident of which branch a comment started
-- on. `branch_id` is display metadata (e.g. the change page's own comment
-- feed), not a second visibility gate.
create or replace function atlas.comment_visible_to_viewer(p_org_id uuid, p_anchor_type anchor_type, p_anchor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select atlas.is_member(p_org_id)
    and (
      atlas.has_role(p_org_id, 'owner', 'architect', 'contributor')
      or (atlas.has_role(p_org_id, 'viewer') and atlas.anchor_visible_to_viewer(p_anchor_type, p_anchor_id))
    );
$$;

revoke all on function atlas.comment_visible_to_viewer(uuid, anchor_type, uuid) from public;
grant execute on function atlas.comment_visible_to_viewer(uuid, anchor_type, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- atlas.check_anchor: the anchor a comment (or its root, for a reply) names
-- must actually exist — checked once, at insert, against permanent history
-- (deltas' element_create/relationship_create rows), never against the
-- *current* head. An element retracted after its comment was posted must
-- stay a valid anchor forever (rule 5: nothing is ever deleted) — checking
-- elements_head here instead would make posting a comment on something
-- already retracted impossible and would have nothing to say about
-- something retracted *after* its comment already exists (it wouldn't need
-- to say anything — the row already exists — but the same table would be
-- wrong to reuse for insert-time validation of a not-yet-retracted anchor,
-- since a live element hasn't been retracted at post time but the check
-- would need to keep working symmetrically for both cases). Also enforces
-- ADR-010's flat reply chain: a reply must point at a root (a comment whose
-- own parent_comment_id is null) and share that root's exact anchor.
-- ---------------------------------------------------------------------------

create or replace function atlas.check_anchor()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_parent comments;
begin
  case new.anchor_type
    when 'element' then
      if not exists (select 1 from deltas where kind = 'element_create' and subject_id = new.anchor_id and model_id = new.model_id) then
        raise exception 'check_anchor: no element % in model %', new.anchor_id, new.model_id using errcode = '23503';
      end if;
    when 'relationship' then
      if not exists (select 1 from deltas where kind = 'relationship_create' and subject_id = new.anchor_id and model_id = new.model_id) then
        raise exception 'check_anchor: no relationship % in model %', new.anchor_id, new.model_id using errcode = '23503';
      end if;
    when 'change' then
      if not exists (select 1 from branches where id = new.anchor_id and model_id = new.model_id) then
        raise exception 'check_anchor: no branch % in model %', new.anchor_id, new.model_id using errcode = '23503';
      end if;
    when 'version' then
      if not exists (select 1 from tags where id = new.anchor_id and model_id = new.model_id) then
        raise exception 'check_anchor: no tag % in model %', new.anchor_id, new.model_id using errcode = '23503';
      end if;
    when 'decision' then
      null; -- Not a migrated table yet (SPEC §11) — anchor existence unchecked until it is.
  end case;

  if new.parent_comment_id is not null then
    select * into v_parent from comments where id = new.parent_comment_id;
    if v_parent.id is null then
      raise exception 'check_anchor: parent comment % not found', new.parent_comment_id using errcode = '23503';
    end if;
    if v_parent.parent_comment_id is not null then
      raise exception 'check_anchor: replies are flat — cannot reply to a reply (ADR-010)' using errcode = '23514';
    end if;
    if v_parent.anchor_type <> new.anchor_type or v_parent.anchor_id <> new.anchor_id then
      raise exception 'check_anchor: a reply must share its root comment''s anchor' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger comments_check_anchor
  before insert on comments
  for each row execute function atlas.check_anchor();

-- ---------------------------------------------------------------------------
-- atlas.guard_comment_update: the same "narrow the update grant, enforce the
-- rest in a trigger" split every other guarded table in this schema uses
-- (see atlas.guard_tag_on_main, the original guard_comment_update drafted
-- in SPEC §9.4). Authors edit their own body; an owner/architect resolves
-- any thread; a contributor resolves only a thread they themselves started
-- (Sprint M1a's own resolve-permission matrix — narrower than SPEC's
-- original owner/architect-only draft).
-- ---------------------------------------------------------------------------

create or replace function atlas.guard_comment_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.org_id is distinct from old.org_id
     or new.model_id is distinct from old.model_id
     or new.anchor_type is distinct from old.anchor_type
     or new.anchor_id is distinct from old.anchor_id
     or new.branch_id is distinct from old.branch_id
     or new.view_kind is distinct from old.view_kind
     or new.parent_comment_id is distinct from old.parent_comment_id
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'comments: only body, status, resolved_by, resolved_at, edited_at may change' using errcode = '42501';
  end if;

  if new.body is distinct from old.body and old.author_id <> auth.uid() then
    raise exception 'only the author may edit a comment' using errcode = '42501';
  end if;

  if (new.status, new.resolved_by, new.resolved_at) is distinct from (old.status, old.resolved_by, old.resolved_at) then
    if old.parent_comment_id is not null then
      raise exception 'only a thread''s root comment carries resolution state' using errcode = '42501';
    end if;
    if not (
      atlas.has_role(old.org_id, 'owner', 'architect')
      or (atlas.has_role(old.org_id, 'contributor') and old.author_id = auth.uid())
    ) then
      raise exception 'only an owner/architect, or the thread''s own author if a contributor, may resolve it' using errcode = '42501';
    end if;
  end if;

  if new.status = 'resolved' and (new.resolved_by is null or new.resolved_at is null) then
    raise exception 'resolved comments need resolved_by and resolved_at';
  end if;
  if new.status = 'open' and (new.resolved_by is not null or new.resolved_at is not null) then
    raise exception 'open comments must not carry resolution metadata';
  end if;

  return new;
end;
$$;

create trigger comments_guard_update
  before update on comments
  for each row execute function atlas.guard_comment_update();

-- ---------------------------------------------------------------------------
-- atlas.process_comment_mentions: parses @handle tokens out of a new
-- comment's body against atlas.profiles.handle (fellow org members only),
-- one comment_mentions row and one notifications row per resolved member.
-- Self-mentions are dropped (mentioning yourself notifies no one). Runs
-- after insert, in the same transaction as the comment itself — a mention
-- and its notification always exist together or not at all.
--
-- The @handle pattern mirrors src/contracts/comments.ts's parseMentions
-- (kept in sync by this migration's own round-trip test comparing the two)
-- so what a client can predict from a body's text is exactly what the
-- server records.
-- ---------------------------------------------------------------------------

create or replace function atlas.process_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_handle text;
  v_user_id uuid;
begin
  for v_handle in
    select distinct lower(m[1]) from regexp_matches(new.body, '@([a-zA-Z0-9_-]+)', 'g') as m
  loop
    select p.user_id into v_user_id
    from atlas.profiles p
    join members mem on mem.user_id = p.user_id and mem.org_id = new.org_id
    where p.handle = v_handle;

    if v_user_id is not null and v_user_id <> new.author_id then
      insert into comment_mentions (comment_id, org_id, user_id) values (new.id, new.org_id, v_user_id)
        on conflict do nothing;
      insert into notifications (id, org_id, user_id, kind, comment_id)
        values (gen_random_uuid(), new.org_id, v_user_id, 'mention', new.id);
    end if;
  end loop;
  return new;
end;
$$;

create trigger comments_process_mentions
  after insert on comments
  for each row execute function atlas.process_comment_mentions();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table comments enable row level security;
alter table comments force row level security;

create policy comments_select on comments
  for select to authenticated
  using (atlas.comment_visible_to_viewer(org_id, anchor_type, anchor_id));

create policy comments_insert on comments
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and author_id = auth.uid()
    and status = 'open'
    and resolved_by is null
    and resolved_at is null
  );

create policy comments_update on comments
  for update to authenticated
  using (
    atlas.is_member(org_id)
    and (
      author_id = auth.uid()
      or atlas.has_role(org_id, 'owner', 'architect')
      or (atlas.has_role(org_id, 'contributor') and parent_comment_id is null)
    )
  )
  with check (
    atlas.is_member(org_id)
    and (
      author_id = auth.uid()
      or atlas.has_role(org_id, 'owner', 'architect')
      or (atlas.has_role(org_id, 'contributor') and parent_comment_id is null)
    )
  );

revoke update on comments from authenticated;
grant select, insert on comments to authenticated;
grant update (body, edited_at, status, resolved_by, resolved_at) on comments to authenticated;

-- No delete policy: comments are never deleted, only resolved (rule 5).

alter table comment_mentions enable row level security;
alter table comment_mentions force row level security;

create policy comment_mentions_select on comment_mentions
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from comments c
      where c.id = comment_mentions.comment_id
        and atlas.comment_visible_to_viewer(c.org_id, c.anchor_type, c.anchor_id)
    )
  );

grant select on comment_mentions to authenticated;
-- No insert/update/delete policy: written only by atlas.process_comment_mentions.

alter table notifications enable row level security;
alter table notifications force row level security;

-- A person's own notifications are private, not org-shared like comments —
-- nobody else, not even an owner, sees who was notified about what.
create policy notifications_select on notifications
  for select to authenticated
  using (user_id = auth.uid());

create policy notifications_update on notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke update on notifications from authenticated;
grant select on notifications to authenticated;
grant update (read_at) on notifications to authenticated;
-- No insert/delete policy: written only by atlas.process_comment_mentions.

-- ---------------------------------------------------------------------------
-- atlas.unresolved_comment_counts: one POST RPC replacing what would
-- otherwise be a GET `.in(anchor_id, [...])` over a caller-supplied id list
-- that grows with the model (rule 8) — element cards and the change page
-- call this once with every anchor id currently on screen instead. Runs as
-- invoker (no security definer): RLS on `comments` applies exactly as it
-- would to any other read, so a viewer's count only ever includes comments
-- they could actually open.
-- ---------------------------------------------------------------------------

create or replace function atlas.unresolved_comment_counts(p_model_id uuid, p_anchor_ids uuid[])
returns table (anchor_id uuid, unresolved_count integer)
language sql
stable
set search_path = public, pg_temp
as $$
  select c.anchor_id, count(*)::int as unresolved_count
  from comments c
  where c.model_id = p_model_id
    and c.anchor_id = any(p_anchor_ids)
    and c.parent_comment_id is null
    and c.status = 'open'
  group by c.anchor_id;
$$;

revoke all on function atlas.unresolved_comment_counts(uuid, uuid[]) from public;
grant execute on function atlas.unresolved_comment_counts(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: comments and commits are broadcast over Supabase Realtime's
-- postgres_changes (RLS-filtered per subscriber, same as any other read) —
-- src/db/realtime.ts's model channel listens on both. Presence (who is
-- viewing which ref) needs no publication entry: it's channel-only,
-- never backed by a table. Guarded with an existence check so this
-- migration is safe to replay against a database where a later migration
-- already added one of these tables to the publication.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments') then
    alter publication supabase_realtime add table comments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'commits') then
    alter publication supabase_realtime add table commits;
  end if;
end $$;
