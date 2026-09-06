/**
 * Wire ↔ storage mapping (SPEC-data-model.md §4.4) as executable code, not
 * just prose. `DeltaRow` / `CommitRow` are the literal Postgres row shapes
 * (snake_case, matching supabase/migrations/20260906071400_history.sql
 * column-for-column) — deliberately not camelCased, so a glance at a field
 * name here tells you which side of the boundary you're looking at.
 *
 * This file is pure data mapping: no I/O, no validation beyond what's
 * needed to construct a well-typed value (src/contracts has no business
 * logic, per CLAUDE.md). It trusts that a row read back from Postgres
 * already satisfies the deltas table's CHECK constraints; it does not
 * re-verify them.
 */

import type {
  CommitEnvelope,
  CommitKind,
  Delta,
  DeltaKind,
  ElementType,
  RelationshipType,
  SubjectType,
  UUID,
} from './delta';
import { EXISTS_ATTRIBUTE, subjectOf } from './delta';

/** A jsonb column's value. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** `deltas.kind` — snake_case, unlike the wire's dot-case `DeltaKind`. */
export type DeltaRowKind =
  | 'element_create'
  | 'element_update'
  | 'element_retract'
  | 'element_restore'
  | 'relationship_create'
  | 'relationship_update'
  | 'relationship_retract'
  | 'relationship_restore';

const WIRE_TO_ROW_KIND: Record<DeltaKind, DeltaRowKind> = {
  'element.create': 'element_create',
  'element.update': 'element_update',
  'element.retract': 'element_retract',
  'element.restore': 'element_restore',
  'relationship.create': 'relationship_create',
  'relationship.update': 'relationship_update',
  'relationship.retract': 'relationship_retract',
  'relationship.restore': 'relationship_restore',
};

const ROW_TO_WIRE_KIND: Record<DeltaRowKind, DeltaKind> = {
  element_create: 'element.create',
  element_update: 'element.update',
  element_retract: 'element.retract',
  element_restore: 'element.restore',
  relationship_create: 'relationship.create',
  relationship_update: 'relationship.update',
  relationship_retract: 'relationship.retract',
  relationship_restore: 'relationship.restore',
};

/** The literal shape of a row in `deltas` (every column, including the generated `subject_type`). */
export interface DeltaRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  commit_id: UUID;
  seq: number;
  kind: DeltaRowKind;
  subject_type: SubjectType;
  subject_id: UUID;
  attribute: string;
  element_type: ElementType | null;
  relationship_type: RelationshipType | null;
  name: string | null;
  parent_id: UUID | null;
  from_element_id: UUID | null;
  to_element_id: UUID | null;
  value: Json | null;
  previous_delta_id: UUID | null;
  source_id: UUID;
  source_ref: string | null;
  effective_date: string | null;
  confidence: number;
  created_by: UUID;
}

/** Context a `Delta` doesn't itself carry but a row needs: where it lives, and who's writing it. */
export interface DeltaRowContext {
  orgId: UUID;
  modelId: UUID;
  commitId: UUID;
  seq: number;
  /** The commit's author — deltas don't carry their own independent author (SPEC §3.4). */
  createdBy: UUID;
}

function assertDefined<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(`rows.ts: ${message}`);
  }
  return value;
}

/** `Delta` → the row `deltas` stores it as. The §4.4 mapping, forward direction. */
export function toDeltaRow(delta: Delta, ctx: DeltaRowContext): DeltaRow {
  const { subjectType, subjectId } = subjectOf(delta);
  const base = {
    id: delta.id,
    org_id: ctx.orgId,
    model_id: ctx.modelId,
    commit_id: ctx.commitId,
    seq: ctx.seq,
    kind: WIRE_TO_ROW_KIND[delta.kind],
    subject_type: subjectType,
    subject_id: subjectId,
    source_id: delta.sourceId,
    source_ref: delta.sourceRef ?? null,
    effective_date: delta.effectiveDate ?? null,
    confidence: delta.confidence,
    created_by: ctx.createdBy,
  };

  switch (delta.kind) {
    case 'element.create':
      return {
        ...base,
        attribute: EXISTS_ATTRIBUTE,
        element_type: delta.elementType,
        relationship_type: null,
        name: delta.name,
        parent_id: delta.parentId,
        from_element_id: null,
        to_element_id: null,
        value: delta.attributes as Json,
        previous_delta_id: null,
      };
    case 'element.update':
      return {
        ...base,
        attribute: delta.attribute,
        element_type: delta.elementType,
        relationship_type: null,
        name: null,
        parent_id: null,
        from_element_id: null,
        to_element_id: null,
        value: delta.value ?? null,
        previous_delta_id: delta.previousDeltaId,
      };
    case 'element.retract':
    case 'element.restore':
      return {
        ...base,
        attribute: EXISTS_ATTRIBUTE,
        element_type: delta.elementType,
        relationship_type: null,
        name: null,
        parent_id: null,
        from_element_id: null,
        to_element_id: null,
        value: null,
        previous_delta_id: delta.previousDeltaId,
      };
    case 'relationship.create':
      return {
        ...base,
        attribute: EXISTS_ATTRIBUTE,
        element_type: null,
        relationship_type: delta.relationshipType,
        name: null,
        parent_id: null,
        from_element_id: delta.fromElementId,
        to_element_id: delta.toElementId,
        value: delta.attributes as Json,
        previous_delta_id: null,
      };
    case 'relationship.update':
      return {
        ...base,
        attribute: delta.attribute,
        element_type: null,
        relationship_type: delta.relationshipType,
        name: null,
        parent_id: null,
        from_element_id: null,
        to_element_id: null,
        value: delta.value ?? null,
        previous_delta_id: delta.previousDeltaId,
      };
    case 'relationship.retract':
    case 'relationship.restore':
      return {
        ...base,
        attribute: EXISTS_ATTRIBUTE,
        element_type: null,
        relationship_type: delta.relationshipType,
        name: null,
        parent_id: null,
        from_element_id: null,
        to_element_id: null,
        value: null,
        previous_delta_id: delta.previousDeltaId,
      };
  }
}

/** The row `deltas` stores → `Delta`. The §4.4 mapping, reverse direction. */
export function fromDeltaRow(row: DeltaRow): Delta {
  const base = {
    id: row.id,
    sourceId: row.source_id,
    ...(row.source_ref !== null ? { sourceRef: row.source_ref } : {}),
    ...(row.effective_date !== null ? { effectiveDate: row.effective_date } : {}),
    confidence: row.confidence,
  };
  const kind = ROW_TO_WIRE_KIND[row.kind];

  switch (kind) {
    case 'element.create': {
      const elementType = assertDefined(row.element_type, 'element.create row missing element_type');
      const name = assertDefined(row.name, 'element.create row missing name');
      return {
        ...base,
        kind,
        elementId: row.subject_id,
        elementType,
        name,
        parentId: row.parent_id,
        // Trusted per this file's header: type_schemas / the engine already
        // validated this jsonb payload against elementType's schema.
        attributes: assertDefined(row.value, 'element.create row missing value') as never,
      };
    }
    case 'element.update': {
      const elementType = assertDefined(row.element_type, 'element.update row missing element_type');
      const previousDeltaId = assertDefined(row.previous_delta_id, 'element.update row missing previous_delta_id');
      return {
        ...base,
        kind,
        elementId: row.subject_id,
        elementType,
        attribute: row.attribute as never,
        value: row.value as never,
        previousDeltaId,
      };
    }
    case 'element.retract':
    case 'element.restore': {
      const elementType = assertDefined(row.element_type, `${kind} row missing element_type`);
      const previousDeltaId = assertDefined(row.previous_delta_id, `${kind} row missing previous_delta_id`);
      return { ...base, kind, elementId: row.subject_id, elementType, previousDeltaId };
    }
    case 'relationship.create': {
      const relationshipType = assertDefined(row.relationship_type, 'relationship.create row missing relationship_type');
      const fromElementId = assertDefined(row.from_element_id, 'relationship.create row missing from_element_id');
      const toElementId = assertDefined(row.to_element_id, 'relationship.create row missing to_element_id');
      return {
        ...base,
        kind,
        relationshipId: row.subject_id,
        relationshipType,
        fromElementId,
        toElementId,
        attributes: assertDefined(row.value, 'relationship.create row missing value') as never,
      };
    }
    case 'relationship.update': {
      const relationshipType = assertDefined(row.relationship_type, 'relationship.update row missing relationship_type');
      const previousDeltaId = assertDefined(row.previous_delta_id, 'relationship.update row missing previous_delta_id');
      return {
        ...base,
        kind,
        relationshipId: row.subject_id,
        relationshipType,
        attribute: row.attribute as never,
        value: row.value as never,
        previousDeltaId,
      };
    }
    case 'relationship.retract':
    case 'relationship.restore': {
      const relationshipType = assertDefined(row.relationship_type, `${kind} row missing relationship_type`);
      const previousDeltaId = assertDefined(row.previous_delta_id, `${kind} row missing previous_delta_id`);
      return { ...base, kind, relationshipId: row.subject_id, relationshipType, previousDeltaId };
    }
  }
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

/** The literal shape of a row in `commits`. */
export interface CommitRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  branch_id: UUID;
  parent_commit_id: UUID | null;
  merged_branch_head_commit_id: UUID | null;
  kind: CommitKind;
  message: string;
  author_id: UUID;
  /** Hex-encoded; null until the head is materialised (SPEC §6.4, S-15). */
  head_hash: string | null;
  depth: number;
  created_at: string;
}

/** What a client actually submits: `head_hash` and `created_at` are always DB/engine-assigned, never client-supplied. */
export type CommitInsertRow = Omit<CommitRow, 'head_hash' | 'created_at'>;

export interface CommitRowContext {
  orgId: UUID;
  modelId: UUID;
  /** 1 + the parent's depth; 0 for a model's genesis commit (SPEC §3.4). */
  depth: number;
}

/** `CommitEnvelope` → the row `commits` stores it as (without its deltas — those are separate rows, see `toDeltaRow`). */
export function toCommitRow(envelope: CommitEnvelope, ctx: CommitRowContext): CommitInsertRow {
  return {
    id: envelope.id,
    org_id: ctx.orgId,
    model_id: ctx.modelId,
    branch_id: envelope.branchId,
    parent_commit_id: envelope.parentCommitId,
    merged_branch_head_commit_id: envelope.mergedBranchHeadCommitId,
    kind: envelope.kind,
    message: envelope.message,
    author_id: envelope.authorId,
    depth: ctx.depth,
  };
}

/**
 * The row `commits` stores, plus its `deltas` rows (already ordered by
 * `seq`, or not — this sorts) → the `CommitEnvelope` they came from.
 * `head_hash`/`created_at`/`org_id`/`model_id`/`depth` have no home on
 * `CommitEnvelope` and are dropped, matching `CommitEnvelope`'s own shape
 * (SPEC §5.1) — that's a one-way loss on the row's *extra* fields, not on
 * anything the envelope itself carries, so `fromCommitRow(toCommitRow(e,
 * ctx), deltaRows) deep-equals e` whenever `deltaRows` reconstructs `e`'s
 * own deltas exactly.
 */
export function fromCommitRow(row: CommitInsertRow | CommitRow, deltaRows: readonly DeltaRow[]): CommitEnvelope {
  const orderedDeltas = [...deltaRows].sort((a, b) => a.seq - b.seq);
  return {
    id: row.id,
    branchId: row.branch_id,
    parentCommitId: row.parent_commit_id,
    mergedBranchHeadCommitId: row.merged_branch_head_commit_id,
    kind: row.kind,
    message: row.message,
    authorId: row.author_id,
    deltas: orderedDeltas.map(fromDeltaRow),
  };
}

/** `CommitEnvelope` → its `deltas` rows, `seq` assigned from array order. */
export function envelopeToDeltaRows(
  envelope: CommitEnvelope,
  ctx: Omit<DeltaRowContext, 'commitId' | 'seq'>,
): DeltaRow[] {
  return envelope.deltas.map((delta, seq) =>
    toDeltaRow(delta, { ...ctx, commitId: envelope.id, seq }),
  );
}

// ---------------------------------------------------------------------------
// Materialised projections (SPEC §3.5, §6.5) — the shapes
// src/engine/projection.ts serialises a folded Head into, and
// atlas.replace_main_head_projection (Sprint U1 step 3a) writes verbatim.
// `commit_id`/`org_id`/`model_id` are omitted here: the SQL function fills
// them in from its own parameters, not from these row bodies.
// ---------------------------------------------------------------------------

/** One row of `elements_head`, minus the columns the writer supplies. */
export interface ElementsHeadRow {
  element_id: UUID;
  element_type: ElementType;
  name: string;
  parent_id: UUID | null;
  attributes: Json;
  exists_delta_id: UUID;
}

/** One row of `relationships_head`, minus the columns the writer supplies. */
export interface RelationshipsHeadRow {
  relationship_id: UUID;
  relationship_type: RelationshipType;
  from_element_id: UUID;
  to_element_id: UUID;
  attributes: Json;
  exists_delta_id: UUID;
}

/** One row of `facts`, minus the `commit_id` column the writer supplies. */
export interface FactsRow {
  subject_type: SubjectType;
  subject_id: UUID;
  attribute: string;
  value: Json | null;
  delta_id: UUID;
  source_id: UUID;
  source_ref: string | null;
  effective_date: string | null;
  confidence: number;
  asserted_by: UUID;
  asserted_at: string;
}
