-- D2, PR 4: a person may keep a reviewer's question on the decision.
--
-- The Challenger and Steward drafts are text for a person to weigh. Nothing is
-- saved when a run finishes; a question is saved only when a person presses
-- "Keep this question" (optionally editing it first). A kept question is shown
-- in its own section on the decision page and in the frozen pack, with the
-- lens, who kept it, the date, and the original AI wording beside any edit.
--
-- It is never an approval, never a concern (those are links to capabilities
-- and systems), and never a write to the live model.
--
-- Insert-only: no update or delete policy or grant. A kept question is a
-- record of what a person chose to keep, not a mutable note.
--
-- No org_id and no foreign keys on branch_id or kept_by: an unindexed foreign
-- key is a performance-advisor finding. The organisation comes from the
-- decision; the branch must be a branch-typed link on that decision when set.
-- The primary key's id has no natural order; the one index leads with
-- decision_id, so the decisions foreign key is covered and a decision's notes
-- read in kept order.

create table decision_agent_notes (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references decisions (id),
  branch_id uuid,
  lens text not null check (lens in ('challenge', 'cyber', 'data')),
  agent text not null check (agent in ('challenger', 'steward')),
  -- The lens decides the agent: challenge is the Challenger; cyber and data are the Steward.
  constraint decision_agent_notes_lens_agent check ((lens = 'challenge') = (agent = 'challenger')),
  suggested_question text not null check (length(btrim(suggested_question)) between 1 and 500),
  question text not null check (length(btrim(question)) between 1 and 500),
  based_on text not null default 'none' check (based_on in ('option', 'element', 'none')),
  based_on_label text,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  run_id uuid,
  kept_by uuid not null,
  kept_at timestamptz not null default now()
);

comment on table decision_agent_notes is 'D2: questions an AI reviewer drafted that a person chose to keep on a decision. Insert-only, never an approval or a concern, never a write to the live model.';

create index decision_agent_notes_decision_kept_idx on decision_agent_notes (decision_id, kept_at);

alter table decision_agent_notes enable row level security;
alter table decision_agent_notes force row level security;

create policy decision_agent_notes_select on decision_agent_notes
  for select to authenticated
  using (exists (select 1 from decisions d where d.id = decision_agent_notes.decision_id and atlas.is_member(d.org_id)));

create policy decision_agent_notes_insert on decision_agent_notes
  for insert to authenticated
  with check (
    kept_by = (select auth.uid())
    and exists (
      select 1 from decisions d
      where d.id = decision_agent_notes.decision_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor')
    )
    and (
      decision_agent_notes.branch_id is null
      or exists (
        select 1 from decision_links dl
        where dl.decision_id = decision_agent_notes.decision_id
          and dl.linked_type = 'branch'
          and dl.linked_id = decision_agent_notes.branch_id
      )
    )
  );

revoke all on decision_agent_notes from public, anon, authenticated;
grant select, insert on decision_agent_notes to authenticated;
