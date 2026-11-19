-- Step F of PROPOSAL-end-to-end-finding-to-decision (Simon, 2026-11-19: "if AI
-- agents are supporting this process it should be clearly indicated").
-- A decision records that an agent drafted part of its context, so the fact
-- survives saving and can be shown on the decision, the approval pack and the
-- ADR export. Three nullable/defaulted columns on `decisions`, nothing else:
-- no new table, function, policy, view or secret.
--
-- * `ai_draft_agent` and `ai_drafted_at` are set together, at creation only:
--   they are NOT in the column-level update grant, so a plain client update
--   cannot change them afterwards (same stance as `created_by`).
-- * `ai_draft_edited` is the one column a person may update (while the
--   decision is proposed; `atlas.guard_decision_update` already enforces
--   that): it becomes true when the draft was edited before use, or the
--   context is edited afterwards.
--
-- These are written by the person's own client, so they record what the
-- person declared; they are provenance for readers, not tamper-proof
-- evidence. Making them tamper-proof means the `design-agent` function
-- writing the mark itself, which is a later step.
alter table decisions
  add column ai_draft_agent text check (ai_draft_agent in ('designer')),
  add column ai_drafted_at timestamptz,
  add column ai_draft_edited boolean not null default false,
  add constraint decisions_ai_draft_together check ((ai_draft_agent is null) = (ai_drafted_at is null)),
  add constraint decisions_ai_draft_edited_needs_agent check (ai_draft_agent is not null or ai_draft_edited = false);

comment on column decisions.ai_draft_agent is 'Which agent drafted part of the context (only ''designer'' so far); null means fully human. Set at creation only.';
comment on column decisions.ai_drafted_at is 'When the agent drafted it. Set together with ai_draft_agent, at creation only.';
comment on column decisions.ai_draft_edited is 'A person edited the agent''s draft before using it, or edited the context afterwards. The one AI-mark column a client may update.';

grant update (ai_draft_edited) on decisions to authenticated;
