/**
 * Row shapes for tables src/contracts has no reason to know about
 * (organisations/models/branches/tags are tenancy and workflow shapes, not
 * part of the delta/commit wire contract — CLAUDE.md scopes src/contracts
 * to "the delta union, commit envelope, invariants" specifically). They
 * live here, next to the repository code that's their only consumer.
 */
import type { UUID } from '../contracts/delta';

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
