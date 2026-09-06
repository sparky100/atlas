/**
 * Row shapes for tables src/contracts has no reason to know about
 * (organisations/models/branches/tags are tenancy and workflow shapes, not
 * part of the delta/commit wire contract — CLAUDE.md scopes src/contracts
 * to "the delta union, commit envelope, invariants" specifically). They
 * live here, next to the repository code that's their only consumer.
 */
import type { UUID } from '../contracts/delta';
import type { SourceKind } from '../contracts/sources';

export type MemberRole = 'owner' | 'architect' | 'contributor' | 'viewer';

/** The literal shape of a row in `organisations` (ADR-009, SPEC §3.2). */
export interface OrganisationRow {
  id: UUID;
  name: string;
  slug: string;
  created_by: UUID;
  created_at: string;
}

/** The literal shape of a row in `members`. */
export interface MemberRow {
  org_id: UUID;
  user_id: UUID;
  role: MemberRole;
  invited_by: UUID | null;
  joined_at: string;
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
}

export type BranchKind = 'main' | 'change' | 'capture_draft';
export type BranchStatus = 'draft' | 'proposed' | 'in_review' | 'approved' | 'merged' | 'rejected' | 'archived';

/**
 * The literal shape of a row in `branches`
 * (supabase/migrations/20260906071400_history.sql,
 * 20260906160000_branches_change_metadata.sql). `base_commit_id` tracks
 * `mergeBase(B)` for a change branch — set at fork, moved to `main`'s head
 * on every successful refresh (SPEC §1 S-11, ADR-005 amendment) — never the
 * original fork point forever.
 */
export interface BranchRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  name: string;
  kind: BranchKind;
  status: BranchStatus;
  base_commit_id: UUID | null;
  head_commit_id: UUID | null;
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
}

export type MergeRequestStatus = 'pending' | 'changes_requested' | 'approved' | 'merged' | 'rejected';

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
  created_at: string;
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

/**
 * Landscape and capability_map are whole-model queries; context/container/
 * component scope to one element (SPEC §3.9). Sprint U1 step 4 only ever
 * creates `landscape` rows — the other four are real schema, not yet a
 * built renderer.
 */
export type ViewKind = 'landscape' | 'context' | 'container' | 'component' | 'capability_map';

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
