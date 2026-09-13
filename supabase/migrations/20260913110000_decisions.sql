-- Prompt pack F3 ("decisions and options") PR4: `decisions`,
-- `decision_arguments`, `decision_links`, `assumptions`, `evidence` —
-- ADR-013's ratified-but-never-migrated schema, extended per ADR-022
-- (`docs/ADR-022-decisions-schema.md`): four new nullable columns on
-- `decisions` (`owner_id`, `needed_by`, `source_finding_key`,
-- `lens_map_url`), and `decision_links.linked_type` using SPEC-data-model.md
-- §3.8's own already-corrected `'branch'` value, not ADR-013's original
-- `'change_branch'`.
--
-- Options/comparison/choosing (`atlas.choose_decision_option`) is PR5 — this
-- migration ships every table `choose_decision_option` will need, but
-- writes to `decisions.status`/`branch_id`/`decided_by`/`decided_at` and to
-- `decision_arguments` are not grantable yet (no RPC exists to make them
-- safe): a decision is created `proposed` and stays that way until PR5.
-- `assumptions`/`evidence` ship schema-complete with no authoring UI this
-- sprint either (CLAUDE.md rule 7 — named here, not faked with a stub UI).

create table decisions (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  title text not null check (length(btrim(title)) > 0),
  -- F3's "context" — written at creation, before any option exists (ADR-013
  -- named this `statement`; F3 reuses the column rather than adding a
  -- second near-duplicate text field for the same idea).
  statement text not null default '',
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'superseded', 'rejected')),
  -- F3's own "owner" — distinct from `decided_by` (who actually closed it,
  -- set only by `choose_decision_option`, PR5). Required: every decision
  -- needs someone accountable for actually driving it to a close.
  owner_id uuid not null references auth.users (id),
  needed_by date,
  -- Which health-finding check a "Start a decision" click traced back to
  -- (PR6) — a stable string key (e.g. 'critical-support-end'), matching
  -- ArchitectHome.tsx's own check keys, never a frozen snapshot of computed
  -- finding text (findings are always recomputed live).
  source_finding_key text,
  -- F3's own "may cite a Lens map by URL; no shared schema" — a bare
  -- column, no FK, taken literally.
  lens_map_url text,
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  -- The chosen option's branch, once accepted — null until then. Only
  -- `choose_decision_option` (PR5) ever sets this.
  branch_id uuid references branches (id),
  -- A decision is never deleted, only superseded (ADR-013) — the same
  -- append-only discipline as everywhere else in this schema.
  superseded_decision_id uuid references decisions (id),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint decisions_decided_consistent check ((status = 'accepted') = (decided_by is not null and decided_at is not null and branch_id is not null))
);

comment on table decisions is 'ADR-013/ADR-022, prompt pack F3: a decision record — context, owner, needed-by date, and (once accepted) the chosen option branch. Options are decision_links rows with linked_type=''branch''.';

create index decisions_model_status_idx on decisions (model_id, status);
create index decisions_branch_id_idx on decisions (branch_id) where branch_id is not null;

create table decision_arguments (
  id uuid primary key,
  decision_id uuid not null references decisions (id),
  stance text not null check (stance in ('for', 'against', 'neutral')),
  body text not null check (length(btrim(body)) > 0),
  author uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table decision_arguments is 'ADR-013: a decision''s own pro/con list — a lightweight, scannable rationale. Written only by atlas.choose_decision_option (PR5), which records the choice''s own reasons here; no open insert grant exists until then.';

create index decision_arguments_decision_id_idx on decision_arguments (decision_id);

create table decision_links (
  decision_id uuid not null references decisions (id),
  -- SPEC-data-model.md §3.8's own already-corrected value list — 'branch',
  -- not ADR-013's original 'change_branch'. An option IS a decision_links
  -- row with linked_type='branch' pointing at an explore-intent branch
  -- (F0) — no separate decision_options table.
  linked_type text not null check (linked_type in ('element', 'relationship', 'branch', 'assumption', 'evidence')),
  linked_id uuid not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (decision_id, linked_type, linked_id)
);

comment on table decision_links is 'ADR-013/ADR-022: polymorphic links from a decision to whatever it concerns or offers as an option — element/relationship (what this decision is about), branch (an option, when linked_type=''branch'' and the branch is explore-intent), assumption/evidence.';

create index decision_links_linked_idx on decision_links (linked_type, linked_id);

create table assumptions (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  statement text not null check (length(btrim(statement)) > 0),
  confidence numeric(3, 2) not null default 1.0 check (confidence between 0 and 1),
  status text not null default 'open' check (status in ('open', 'validated', 'invalidated')),
  owner uuid references auth.users (id),
  -- Set true on every linked decision when this assumption's own status
  -- changes (the "re-review nudge") — the trigger/UI that actually does
  -- that is unbuilt this sprint (ADR-013's own deferred workflow layer);
  -- the column exists so nothing reading it later has to be retrofitted.
  linked_review_pending boolean not null default false,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table assumptions is 'ADR-013: first-class and independent of any one decision — an assumption can be linked from several. Schema-complete; no authoring UI ships this sprint (CLAUDE.md rule 7).';

create index assumptions_model_status_idx on assumptions (model_id, status);

create table evidence (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  kind text not null check (kind in ('document', 'link', 'capture_job_ref', 'comment_ref')),
  pointer text not null check (length(btrim(pointer)) > 0),
  description text,
  -- A piece of evidence that is also a capture source is the same row in
  -- both roles (SPEC §3.8's own amendment) — nullable, since not every
  -- piece of evidence originated from the capture pipeline.
  source_id uuid references sources (id),
  added_by uuid not null references auth.users (id),
  added_at timestamptz not null default now()
);

comment on table evidence is 'ADR-013: a document, link, capture-job reference, or comment reference cited in support of a decision or assumption. Schema-complete; no authoring UI ships this sprint (CLAUDE.md rule 7).';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table decisions enable row level security;
alter table decisions force row level security;

create policy decisions_select on decisions
  for select to authenticated
  using (atlas.is_member(org_id));

create policy decisions_insert on decisions
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and created_by = auth.uid()
    and status = 'proposed'
    and decided_by is null
    and decided_at is null
    and branch_id is null
    and superseded_decision_id is null
  );

create policy decisions_update on decisions
  for update to authenticated
  using (
    atlas.is_member(org_id)
    and status = 'proposed'
    and (created_by = auth.uid() or atlas.has_role(org_id, 'owner', 'architect'))
  )
  with check (
    atlas.is_member(org_id)
    and status = 'proposed'
    and (created_by = auth.uid() or atlas.has_role(org_id, 'owner', 'architect'))
  );

revoke update on decisions from authenticated;
grant select, insert on decisions to authenticated;
-- status/decided_by/decided_at/branch_id/superseded_decision_id are
-- atlas.choose_decision_option-only (PR5) — never in this grant list, so a
-- plain client update can't touch them even while status='proposed'
-- (the trigger below also refuses if it tries).
grant update (title, statement, owner_id, needed_by, source_finding_key, lens_map_url) on decisions to authenticated;

-- No delete policy: a decision is never deleted, only superseded (ADR-013).

create or replace function atlas.guard_decision_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status
     or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at
     or new.branch_id is distinct from old.branch_id
     or new.superseded_decision_id is distinct from old.superseded_decision_id
     or new.org_id is distinct from old.org_id
     or new.model_id is distinct from old.model_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'guard_decision_update: only title/statement/owner_id/needed_by/source_finding_key/lens_map_url may change by plain update — status/decided_by/decided_at/branch_id/superseded_decision_id are atlas.choose_decision_option-only' using errcode = '42501';
  end if;
  if old.status <> 'proposed' then
    raise exception 'guard_decision_update: a decision''s own fields are only editable while proposed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger decisions_guard_update
  before update on decisions
  for each row execute function atlas.guard_decision_update();

alter table decision_arguments enable row level security;
alter table decision_arguments force row level security;

create policy decision_arguments_select on decision_arguments
  for select to authenticated
  using (exists (select 1 from decisions d where d.id = decision_arguments.decision_id and atlas.is_member(d.org_id)));

grant select on decision_arguments to authenticated;
-- No insert/update/delete policy: written only by atlas.choose_decision_option (PR5).

alter table decision_links enable row level security;
alter table decision_links force row level security;

create policy decision_links_select on decision_links
  for select to authenticated
  using (exists (select 1 from decisions d where d.id = decision_links.decision_id and atlas.is_member(d.org_id)));

create policy decision_links_insert on decision_links
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from decisions d
      where d.id = decision_links.decision_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor')
    )
  );

grant select, insert on decision_links to authenticated;
-- No update/delete policy this sprint — no editing UI for a link exists
-- yet (F3's own "Add an option"/"link a capability" flows only ever add).

alter table assumptions enable row level security;
alter table assumptions force row level security;

create policy assumptions_select on assumptions
  for select to authenticated
  using (atlas.is_member(org_id));

create policy assumptions_insert on assumptions
  for insert to authenticated
  with check (atlas.has_role(org_id, 'owner', 'architect', 'contributor') and created_by = auth.uid());

grant select, insert on assumptions to authenticated;
-- No update/delete policy: no authoring UI ships this sprint (see table comment).

alter table evidence enable row level security;
alter table evidence force row level security;

create policy evidence_select on evidence
  for select to authenticated
  using (atlas.is_member(org_id));

create policy evidence_insert on evidence
  for insert to authenticated
  with check (atlas.has_role(org_id, 'owner', 'architect', 'contributor') and added_by = auth.uid());

grant select, insert on evidence to authenticated;
-- No update/delete policy: no authoring UI ships this sprint (see table comment).

-- ---------------------------------------------------------------------------
-- Decision-anchor wiring: `decisions` now exists, so `atlas.
-- anchor_visible_to_viewer`/`atlas.check_anchor`'s `'decision'` placeholder
-- cases (20260906240000_comments.sql) become real existence+membership
-- checks — no contract change, `anchor_type` already had `'decision'`.
-- Same signatures, `create or replace`.
-- ---------------------------------------------------------------------------

create or replace function atlas.anchor_visible_to_viewer(p_type anchor_type, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p_type
    -- A decision is org-shared, not branch-scoped or draft-hidden like an
    -- element/relationship can be — every org member sees it regardless of
    -- its own status, the same bare-existence check `version` already uses
    -- below. This function takes no org_id of its own (see `change`/
    -- `version`'s own existing cases) — the caller,
    -- `atlas.comment_visible_to_viewer`, already scopes by the comment's
    -- own `org_id` via `atlas.is_member`, and `atlas.check_anchor` already
    -- guarantees the anchor's `model_id` (hence org) matches the comment's
    -- at insert time.
    when 'decision' then exists (select 1 from decisions where id = p_id)
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

-- Same replacement for the insert-time existence check — identical body to
-- 20260906240000_comments.sql's own atlas.check_anchor(), except the
-- 'decision' branch, which now checks the real table instead of `null`
-- ("not a migrated table yet"). The trigger (comments_check_anchor,
-- already created) picks up this new body automatically — a function body
-- swap, not a trigger recreation.
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
      if not exists (select 1 from decisions where id = new.anchor_id and model_id = new.model_id) then
        raise exception 'check_anchor: no decision % in model %', new.anchor_id, new.model_id using errcode = '23503';
      end if;
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
