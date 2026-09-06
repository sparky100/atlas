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

/** The literal shape of a row in `branches` (supabase/migrations/20260906071400_history.sql). */
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
  created_by: UUID;
  updated_at: string;
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
