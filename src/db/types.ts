/**
 * Row shapes for tables src/contracts has no reason to know about
 * (organisations/models/branches/tags are tenancy and workflow shapes, not
 * part of the delta/commit wire contract — CLAUDE.md scopes src/contracts
 * to "the delta union, commit envelope, invariants" specifically). They
 * live here, next to the repository code that's their only consumer.
 */
import type { AttributeDefinitionKind } from '../contracts/attributeSchema';
import type { ElementType, UUID } from '../contracts/delta';
import type { SourceKind } from '../contracts/sources';
export type { AnchorType, CommentStatus, NotificationKind } from '../contracts/comments';
import type { AnchorType, CommentStatus, NotificationKind } from '../contracts/comments';

export type MemberRole = 'owner' | 'architect' | 'contributor' | 'viewer';

/** The literal shape of a row in `organisations` (ADR-009, SPEC §3.2). */
export interface OrganisationRow {
  id: UUID;
  name: string;
  slug: string;
  created_by: UUID;
  created_at: string;
  /** F3a: a personal ("just me") organisation — reads as such in settings, and skips the invite step. */
  is_personal: boolean;
  /** F3a: the minimum number of architect members the required reviewer set must include (org review policy), default 1. */
  review_min_required_architects: number;
}

/** The literal shape of a row in `members`. */
export interface MemberRow {
  org_id: UUID;
  user_id: UUID;
  role: MemberRole;
  invited_by: UUID | null;
  joined_at: string;
}

/** The literal shape of a row in `invites` (Sprint 7j item 4, `20260911060000_invites.sql`). `email` is always lowercase (the table's own check constraint). `consumed_at`/`consumed_by` are both `null` until a matching signup or sign-in consumes it — never written by a client. */
export interface InviteRow {
  id: UUID;
  org_id: UUID;
  email: string;
  role: MemberRole;
  invited_by: UUID;
  created_at: string;
  consumed_at: string | null;
  consumed_by: UUID | null;
  /** Sprint F7 item 1: when the invite email (Resend) was last successfully sent — null until the first successful send. The only column on this row any client write ever reaches (`20260914030000_invites_last_sent_at.sql`). */
  last_sent_at: string | null;
}

export type MemberEventType = 'invited' | 'invite_revoked' | 'joined' | 'role_changed' | 'removed' | 'left';

/** The literal shape of a row in `member_events` (F7 item 5, `20260916030000_member_events.sql`) — an append-only membership-lifecycle audit trail, written only by that migration's five triggers, never a client write. */
export interface MemberEventRow {
  id: UUID;
  org_id: UUID;
  event_type: MemberEventType;
  target_user_id: UUID | null;
  target_email: string | null;
  actor_id: UUID | null;
  role: MemberRole | null;
  previous_role: MemberRole | null;
  created_at: string;
}

/** The literal shape of a row in `models`. */
export interface ModelRow {
  id: UUID;
  org_id: UUID;
  name: string;
  slug: string;
  description: string | null;
  schema_version: number;
  created_by: UUID;
  created_at: string;
  /** Sprint 7j item 1: set by `atlas.archive_model`, cleared by `atlas.restore_model` — see that migration's own comment. */
  archived_at: string | null;
}

/** F7 item 4: a cross-org, read-only grant on a model, optionally pinned to one tag (ADR-009, SPEC §3.2). */
export interface ModelShareRow {
  id: UUID;
  model_id: UUID;
  /** Null = "current main"; set = "this version only". */
  tag_id: UUID | null;
  shared_with_org_id: UUID;
  permission: 'view_only';
  expires_at: string | null;
  created_by: UUID;
  created_at: string;
}

export type BranchKind = 'main' | 'change' | 'capture_draft';
/** S1 item 4: `cancelled` — a proposer or owner/architect calling it off from `draft`/`proposed`, via `atlas.cancel_change`; terminal, like `merged`/`rejected`. */
export type BranchStatus = 'draft' | 'proposed' | 'in_review' | 'approved' | 'merged' | 'rejected' | 'archived' | 'cancelled';
/** Prompt pack F0 ("change intent — the why"): why a change branch exists, set at creation and editable only while `status === 'draft'` (`atlas.guard_branch_intent_update`, `20260913100000_change_intent.sql`) — `null` for `main`/`capture_draft` branches, never `null` for a `change` one (a DB constraint enforces this pairing). Drives the change workspace's header line, required fields, and review weight (`src/ui/changes/branchIntent.ts`) — never read by `src/engine`, the same stance `BranchStatus` itself takes. */
export type BranchIntent = 'record' | 'propose' | 'correct' | 'explore';

/**
 * The literal shape of a row in `branches`
 * (supabase/migrations/20260906071400_history.sql,
 * 20260906160000_branches_change_metadata.sql). `base_commit_id` tracks
 * `mergeBase(B)` for a change branch — set at fork, moved to `main`'s head
 * on every successful refresh (SPEC §1 S-11, ADR-005 amendment) — never the
 * original fork point forever.
 *
 * `base_commit_id`/`head_commit_id` are `NOT NULL` (ADR-018,
 * `supabase/migrations/20260906220000_main_always_has_head.sql`): every
 * branch, `main` included, is born with a real commit already attached —
 * `main`'s own genesis commit, inserted by `atlas.on_model_created` in the
 * same transaction as the model itself, never a later fix-up. Before
 * ADR-018 these were nullable for `main` specifically, until its first
 * real commit landed; that state no longer exists.
 */
export interface BranchRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  name: string;
  kind: BranchKind;
  status: BranchStatus;
  base_commit_id: UUID;
  head_commit_id: UUID;
  shared_for_review: boolean;
  title: string | null;
  /** Change branches: free-text description of the change, set at creation. */
  description: string | null;
  /** Change branches: the intended delivery date shown on the change page and roadmap. */
  target_date: string | null;
  /** Set only on a branch created by partial acceptance in the review queue (ADR-006 amendment, SPEC §1 S-22) — the branch it was split out of. */
  split_from: UUID | null;
  created_by: UUID;
  updated_at: string;
  /** S1 item 4, set together by `atlas.cancel_change`: the proposer or owner/architect's own stated reason, `null` unless `status === 'cancelled'`. */
  cancel_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: UUID | null;
  /** S1 item 16: identity-warning pairs dismissed on this draft's own rebase panel, before any merge request exists — see `20260913020000_branch_identity_dismissals.sql`'s own comment for why this is a separate column from `MergeRequestRow.dismissed_identity_pairs`. */
  dismissed_identity_pairs: string[];
  /** Prompt pack F0: `null` for `main`/`capture_draft`; always set for a `change` branch. See `BranchIntent`'s own doc comment. */
  intent: BranchIntent | null;
}

export type MergeRequestStatus = 'pending' | 'changes_requested' | 'approved' | 'merged' | 'rejected';

/** F3a: one assigned reviewer's verdict on a merge request (`review_verdicts`). */
export type ReviewVerdict = 'approve' | 'request_changes' | 'abstain' | 'pending';

/** The literal shape of a row in `merge_requests` (SPEC §3.7, ADR-006) — written only by the atlas.* review-queue functions in supabase/migrations/20260906161000_merge_review_queue.sql, never a raw insert/update. */
export interface MergeRequestRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  branch_id: UUID;
  requested_head_commit_id: UUID;
  main_head_commit_id: UUID;
  status: MergeRequestStatus;
  requested_by: UUID;
  reviewed_by: UUID | null;
  reviewed_at: string | null;
  review_notes: string | null;
  merge_commit_id: UUID | null;
  /** The engine-computed §7 output (threeWayDiff + classifyMerge), cached at request and at each refresh. */
  classification: Record<string, unknown>;
  /** SPEC §10.2 P-18: identity-warning pairs ("keep both") dismissed for this request — sorted "<idA> <idB>" pair keys, the same shape `useReviewRequest.ts` already derives. Survives `classification` being wholly recomputed on every refresh/resubmit (a separate column for exactly that reason — Sprint C2 step 7). */
  dismissed_identity_pairs: string[];
  created_at: string;
}

/** The literal shape of a row in `review_verdicts` (F3a) — written only by `atlas.submit_merge_request`/`set_reviewers`/`set_review_verdict`, never a raw client insert/update. */
export interface ReviewVerdictRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  merge_request_id: UUID;
  user_id: UUID;
  /** Whether this reviewer's approval is required for the merge gate. */
  required: boolean;
  verdict: ReviewVerdict;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

/** The literal shape of a row in `resolved_conflicts` (SPEC §3.6, ADR-007) — a human's choice between two disagreeing facts, written only by atlas.commit_deltas alongside the resolving commit. */
export interface ResolvedConflictRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  winning_delta_id: UUID;
  discarded_delta_id: UUID;
  resolution_delta_id: UUID | null;
  resolved_by: UUID;
  rationale: string | null;
  created_at: string;
}

/** The literal shape of a row in `tags`. */
export interface TagRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  name: string;
  commit_id: UUID;
  description: string | null;
  created_by: UUID;
  created_at: string;
}

/** The literal shape of a row in `sources` (SPEC §3.6, ADR-007) — what a provenance badge's hover card names as "where this came from." */
export interface SourceRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  kind: SourceKind;
  name: string;
  uri: string | null;
  captured_at: string | null;
  capture_job_id: UUID | null;
  capability_map_id: UUID | null;
  user_id: UUID | null;
  created_by: UUID;
  created_at: string;
}

export type AliasType = 'name' | 'code' | 'external_ref' | 'source_system_key' | 'template_code' | 'merged_id';

/** The literal shape of a row in `aliases` (SPEC §3.6, ADR-008) — not commit-scoped, unlike elements_head/relationships_head/facts. */
export interface AliasRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  element_id: UUID;
  alias_value: string;
  alias_type: AliasType;
  source_id: UUID;
  confidence: number;
  created_by: UUID;
  created_at: string;
}

/** The literal shape of a row in `element_merges` (ADR-019, SPEC §3.6, E7 — `20260916050000_element_merges.sql`) — a reversible identity merge, append-only (CLAUDE.md rule 5). `commit_id` is the ordinary `manual` commit that actually retracted `merged_element_id` and re-pointed its relationships/children. */
export interface ElementMergeRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  surviving_element_id: UUID;
  merged_element_id: UUID;
  decided_by: UUID;
  rationale: string;
  evidence_id: UUID | null;
  commit_id: UUID;
  created_at: string;
}

export type LlmProxyRequestStatus = 'ok' | 'error' | 'rate_limited';

/** The literal shape of a row in `llm_proxy_requests` (ADR-014, E4 — `20260917010000_llm_proxy_requests.sql`) — a per-org LLM proxy call log, append-only, no prompt/response payload column at all (deliberate: "request logging without payload retention"). */
export interface LlmProxyRequestRow {
  id: UUID;
  org_id: UUID;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  status: LlmProxyRequestStatus;
  latency_ms: number | null;
  created_at: string;
}

/**
 * Landscape and capability_map are whole-model queries; context/container
 * scope to one element (SPEC §3.9). Sprint U1 step 4 only ever creates
 * `landscape` rows — the other three are real schema, not yet a built
 * renderer. `component` was a fourth scoped kind until S1 item 18 removed
 * the component level from the taxonomy entirely.
 */
export type ViewKind = 'landscape' | 'context' | 'container' | 'capability_map';

// ---------------------------------------------------------------------------
// Collaboration (Sprint M1a): profiles, comments, mentions, notifications.
// See supabase/migrations/20260906230000_profiles.sql and
// 20260906240000_comments.sql for the full column-by-column rationale.
// ---------------------------------------------------------------------------

/** The literal shape of a row in `atlas.profiles` (SPEC §3.2 amendment, ADR-009 amendment). No email column — never exposed to fellow members. */
export interface ProfileRow {
  user_id: UUID;
  display_name: string | null;
  handle: string;
  avatar_url: string | null;
  updated_at: string;
}

/** The literal shape of a row in `comments` (SPEC §3.8 amendment, ADR-010 amendment). Anchors are stable subject ids, never commit ids. */
export interface CommentRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  anchor_type: AnchorType;
  anchor_id: UUID;
  branch_id: UUID | null;
  view_kind: ViewKind | null;
  parent_comment_id: UUID | null;
  body: string;
  author_id: UUID;
  status: CommentStatus;
  resolved_by: UUID | null;
  resolved_at: string | null;
  created_at: string;
  edited_at: string | null;
}

/** The literal shape of a row in `comment_mentions` — written only by `atlas.process_comment_mentions`. */
export interface CommentMentionRow {
  comment_id: UUID;
  org_id: UUID;
  user_id: UUID;
}

/** The literal shape of a row in `notifications` — written only by `atlas.process_comment_mentions` and (F3a) `atlas.submit_merge_request`/`atlas.set_reviewers`. In-app only, no email delivery. */
export interface NotificationRow {
  id: UUID;
  org_id: UUID;
  user_id: UUID;
  kind: NotificationKind;
  comment_id: UUID | null;
  /** F3a: set only for `review_assigned` notifications, null for comment mention/reply notifications. */
  merge_request_id: UUID | null;
  read_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Decisions (ADR-013, extended by ADR-022 for prompt pack F3 — see
// docs/ADR-022-decisions-schema.md and supabase/migrations/20260913110000_decisions.sql
// for the full column-by-column rationale).
// ---------------------------------------------------------------------------

export type DecisionStatus = 'proposed' | 'accepted' | 'superseded' | 'rejected';
export type DecisionArgumentStance = 'for' | 'against' | 'neutral';
/** SPEC-data-model.md §3.8's own already-corrected value list — `'branch'`, not ADR-013's original `'change_branch'`. An option (F3) is a `decision_links` row with `linked_type: 'branch'` pointing at an `explore`-intent branch (F0) — no separate `decision_options` table. */
export type DecisionLinkedType = 'element' | 'relationship' | 'branch' | 'assumption' | 'evidence';
export type AssumptionStatus = 'open' | 'validated' | 'invalidated';
export type EvidenceKind = 'document' | 'link' | 'capture_job_ref' | 'comment_ref';

/** The literal shape of a row in `decisions`. `decided_by`/`decided_at`/`branch_id` are set only by `atlas.choose_decision_option` (PR5) — never by a plain client update, whatever `status='proposed'` allows for the other columns. */
export interface DecisionRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  title: string;
  /** F3's own "context" — ADR-013 named this `statement`; F3 reuses the column rather than adding a second near-duplicate text field. */
  statement: string;
  status: DecisionStatus;
  /** F3's own "owner" — distinct from `decided_by` (who actually closed it). Required at creation. */
  owner_id: UUID;
  needed_by: string | null;
  /** Which health-finding check a "Start a decision" click traced back to (PR6) — a stable string key, never a frozen snapshot of computed finding text. */
  source_finding_key: string | null;
  /** F3's own "may cite a Lens map by URL; no shared schema" — a bare column, no FK. */
  lens_map_url: string | null;
  decided_by: UUID | null;
  decided_at: string | null;
  /** The chosen option's branch, once accepted (PR5). */
  branch_id: UUID | null;
  superseded_decision_id: UUID | null;
  created_by: UUID;
  created_at: string;
}

/** The literal shape of a row in `decision_arguments` — a decision's own pro/con list. Written only by `atlas.choose_decision_option` (PR5); no open insert grant exists until then. */
export interface DecisionArgumentRow {
  id: UUID;
  decision_id: UUID;
  stance: DecisionArgumentStance;
  body: string;
  author: UUID;
  created_at: string;
}

/** The literal shape of a row in `decision_links` — a polymorphic link from a decision to whatever it concerns (`element`/`relationship`) or offers as an option (`branch`, F3's own options mechanism) or cites (`assumption`/`evidence`). Primary key `(decision_id, linked_type, linked_id)`, so no `id` column of its own. */
export interface DecisionLinkRow {
  decision_id: UUID;
  linked_type: DecisionLinkedType;
  linked_id: UUID;
  created_by: UUID;
  created_at: string;
}

/** The literal shape of a row in `assumptions` — first-class and independent of any one decision (ADR-013). Schema-complete; no authoring UI ships this sprint (CLAUDE.md rule 7). */
export interface AssumptionRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  statement: string;
  confidence: number;
  status: AssumptionStatus;
  owner: UUID | null;
  /** Set true on every linked decision when this assumption's own status changes (the "re-review nudge") — the mechanism that actually sets this is unbuilt this sprint (ADR-013's own deferred workflow layer). */
  linked_review_pending: boolean;
  created_by: UUID;
  created_at: string;
}

/** The literal shape of a row in `evidence`. Schema-complete; no authoring UI ships this sprint (CLAUDE.md rule 7). */
export interface EvidenceRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  kind: EvidenceKind;
  pointer: string;
  description: string | null;
  /** A piece of evidence that is also a capture source is the same row in both roles (SPEC §3.8 amendment) — nullable, since not every piece of evidence originated from the capture pipeline. */
  source_id: UUID | null;
  added_by: UUID;
  added_at: string;
}

/** The literal shape of a row in `views` (SPEC §3.9, ADR-011) — a saved query, not a saved drawing. */
export interface ViewRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  name: string;
  kind: ViewKind;
  scope_element_id: UUID | null;
  /** Which branch's folded state to render; null = main's head. Always null in Sprint U1 — no branch UI yet (ADR-015). */
  branch_id: UUID | null;
  created_by: UUID;
  created_at: string;
}

export type LayoutSubjectType = 'element' | 'relationship';

/** The literal shape of a row in `view_layouts` — a position hint (ADR-011), never model data. */
export interface ViewLayoutRow {
  org_id: UUID;
  view_id: UUID;
  subject_type: LayoutSubjectType;
  subject_id: UUID;
  x: number | null;
  y: number | null;
  bends: { x: number; y: number }[] | null;
  updated_by: UUID;
  updated_at: string;
}

export type AnnotationKind = 'text' | 'highlight' | 'arrow';

/** The literal shape of a row in `view_annotations` — free-form presentational markup, never a fact (ADR-011). Sprint U1 step 4a creates the table but has no writer for it yet. */
export interface ViewAnnotationRow {
  id: UUID;
  org_id: UUID;
  view_id: UUID;
  kind: AnnotationKind;
  geometry: Record<string, unknown>;
  text: string | null;
  created_by: UUID;
  created_at: string;
}

/**
 * F1 ("custom attributes") — org-defined attributes, stored as data rather
 * than code (`src/contracts/attributeSchema.ts`'s `AttributeDefinitionKind`
 * doc comment explains why that type lives in `src/contracts`, not here).
 * `applies_to` names which element types this definition shows up on — an
 * `ElementType[]`, never a `RelationshipType`; the prompt pack's own
 * "element/relationship types" language is about the *feature* covering
 * both, not this one column carrying a mixed union (a relationship-scoped
 * custom attribute is out of this sprint's PR1/PR3 scope — see the F1 plan's
 * own "Set and view on an element" framing — so `applies_to` only ever
 * needs `ElementType` today; widening it is additive, not a breaking change,
 * if a relationship-scoped version is ever built).
 */
export interface AttributeDefinitionRow {
  id: UUID;
  org_id: UUID;
  key: string;
  label: string;
  kind: AttributeDefinitionKind;
  options: readonly string[] | null;
  applies_to: readonly ElementType[];
  required: boolean;
  description: string | null;
  order_index: number;
  deprecated_at: string | null;
  created_by: UUID;
  created_at: string;
}
