/**
 * F2 (full K1), SPEC-capture.md §3.2/§3.3/§4: the candidate contract and
 * `CaptureJob`/`CaptureCandidate` wire types, plus the row↔wire round trip
 * (RT-K1) — kept together in one file per SPEC-capture.md's own opening
 * line under §4 ("Authoritative definition: src/contracts/capture.ts").
 * `src/db/types.ts` imports the domain types defined here for its own
 * `CaptureJobRow`/`CaptureCandidateRow` (the raw-row half of the split),
 * the same direction `db/types.ts` already uses for `comments.ts`'s
 * `AnchorType`/`CommentStatus`/`NotificationKind`.
 *
 * No I/O here (CLAUDE.md's own `src/contracts` scope) — `capture-run`
 * (the Deno edge function, PR12) imports this file directly (K-15), so it
 * has to stay a runtime `src` can load with no Supabase client, no
 * `fetch`, nothing browser- or Node-specific.
 */
import type { ElementAttributesByType, ElementType, RelationshipAttributesByType, RelationshipType, UUID } from './delta';
import type { SourceRef } from './sourceRef';

export type CaptureStatus = 'pending' | 'parsed' | 'reviewed' | 'discarded';

export type CaptureInputKind = 'spreadsheet' | 'pdf' | 'text';

/** {stage, done, total, startedAt, updatedAt} — persisted after every bounded step (K-12) so a crash loses at most one chunk of work. */
export interface CaptureJobProgress {
  stage: 'parse' | 'extract' | 'match' | 'write';
  done: number;
  total: number;
  startedAt: string;
  updatedAt: string;
}

/** Accumulated per run, for per-org cost attribution (ADR-014). */
export interface CaptureJobLlmUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  model: string;
  promptVersion: string;
}

/** {code, message, detail?} — SPEC §11's own failure-code shape, stored as `capture_jobs.error` (text, JSON-encoded). */
export interface CaptureJobError {
  code: string;
  message: string;
  detail?: unknown;
}

/** Counts by match outcome/class (§8), written once at the end of `write`. */
export type CaptureJobStats = Record<string, number>;

export interface CaptureJob {
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  inputKind: CaptureInputKind;
  inputName: string;
  inputRef: string;
  /**
   * Hex-encoded SHA-256 of the stored object (64 lowercase hex chars, no
   * `\x` prefix) — the column itself is `bytea`; PostgREST's own `\x`-prefixed
   * wire form is a `src/db` (not `src/contracts`) concern, decoded/encoded
   * at the actual insert/select boundary a later PR adds.
   */
  inputSha256: string;
  documentDate: string | null;
  status: CaptureStatus;
  resultingBranchId: UUID | null;
  reimportOfJobId: UUID | null;
  targetBranchId: UUID | null;
  progress: CaptureJobProgress | null;
  llmUsage: CaptureJobLlmUsage | null;
  stats: CaptureJobStats | null;
  error: CaptureJobError | null;
  createdBy: UUID;
  createdAt: string;
  finishedAt: string | null;
}

// ---------------------------------------------------------------------------
// §4.1 is sourceRef.ts. §4.2: proposal.
// ---------------------------------------------------------------------------

export type CandidateRef =
  | { kind: 'candidate'; seq: number }
  | { kind: 'existing'; elementId: UUID }
  | { kind: 'unresolved'; text: string };

export interface ElementProposal<T extends ElementType = ElementType> {
  kind: 'element';
  elementType: T;
  name: string;
  parent: CandidateRef | null;
  attributes: Partial<ElementAttributesByType[T]>;
}

export interface RelationshipProposal<R extends RelationshipType = RelationshipType> {
  kind: 'relationship';
  relationshipType: R;
  from: CandidateRef;
  to: CandidateRef;
  attributes: RelationshipAttributesByType[R];
}

export type CandidateProposal = ElementProposal | RelationshipProposal;

// ---------------------------------------------------------------------------
// §4.3: evidence.
// ---------------------------------------------------------------------------

export type Extractor = 'sheet-mapping' | 'prose-llm' | 'capability-llm' | 'reimport-diff';

export type EvidenceWarning =
  | { code: 'MERGED_CELL'; cell: string }
  | { code: 'FORMULA_ERROR'; cell: string }
  | { code: 'AMBIGUOUS_DATE'; cell: string; parsedAs: string }
  | { code: 'ENUM_FUZZY'; cell: string; raw: string; parsedAs: string }
  | { code: 'PASSAGE_NORMALISED' }
  | { code: 'MULTI_VALUE_CELL'; cell: string }
  | { code: 'LOW_MAPPING_CONFIDENCE'; column: string; confidence: number };

export interface CandidateEvidence {
  sourceRef: SourceRef;
  /** Verbatim text the fact rests on — never model-paraphrased. */
  passage: string;
  extractor: Extractor;
  attributeRefs?: Record<string, SourceRef>;
  attributeConfidence: Record<string, number>;
  warnings: EvidenceWarning[];
}

// ---------------------------------------------------------------------------
// §7.5: match outcome. `aliasType` duplicates `src/db/types.ts`'s own
// `AliasType` union literal-for-literal rather than importing it —
// `src/contracts` never depends on `src/db` (CLAUDE.md's layering), the
// same kind of small, deliberate duplication `src/contracts/llmProxy.ts`'s
// own module comment already accepts across a bigger boundary (Deno).
// ---------------------------------------------------------------------------

export type CaptureAliasType = 'name' | 'code' | 'external_ref' | 'source_system_key' | 'template_code' | 'merged_id';

export interface MatchOutcome {
  level: 'exact_id' | 'alias' | 'name_context' | 'none';
  elementId?: UUID;
  /** 1 for levels 1–2; trigram similarity for level 3; 0 for `none`. */
  score: number;
  aliasType?: CaptureAliasType;
  ambiguous?: { elementId: UUID; name: string; score: number; parentName?: string }[];
  /** 0.50–0.60 near-misses, shown as a UI warning, never auto-matched. */
  similar: { elementId: UUID; name: string; score: number; parentName?: string }[];
  warnings: ('ATLAS_ID_NOT_FOUND' | 'RESOLVED_THROUGH_MERGED_ID')[];
}

// ---------------------------------------------------------------------------
// §4.4: class: the 8-value taxonomy `classify()` (PR2) assigns.
// ---------------------------------------------------------------------------

export type CandidateClass = 'new' | 'update' | 'confirm' | 'conflict' | 'ambiguous' | 'gone' | 'invalid' | 'unsourced';

export type CandidateDecision = 'accepted' | 'rejected' | 'merged' | 'edited' | 'split';

export type CandidateDecisionDetail =
  | { intoElementId: UUID }
  | { attributes: Record<string, unknown> }
  | { acceptedAttributes: string[] };

export type CandidateReimportStatus = 'new' | 'changed' | 'unchanged' | 'gone';

export interface CaptureCandidate {
  id: UUID;
  orgId: UUID;
  jobId: UUID;
  modelId: UUID;
  seq: number;
  kind: 'element' | 'relationship';
  class: CandidateClass;
  elementType: ElementType | null;
  relationshipType: RelationshipType | null;
  draftSubjectId: UUID | null;
  proposal: CandidateProposal;
  evidence: CandidateEvidence;
  match: MatchOutcome;
  confidence: number;
  rowKey: string;
  reimportStatus: CandidateReimportStatus | null;
  draftDeltaIds: UUID[];
  decision: CandidateDecision | null;
  decisionDetail: CandidateDecisionDetail | null;
  decidedBy: UUID | null;
  decidedAt: string | null;
  promotedCommitId: UUID | null;
  promotedSubjectId: UUID | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Row↔wire (RT-K1). Row shapes: `src/db/types.ts`'s `CaptureJobRow`/
// `CaptureCandidateRow` (imports the domain types above for their jsonb
// columns — Postgres/PostgREST already hands back a parsed JS value for
// jsonb, so there is no second decode step, unlike a bytea or a date).
// ---------------------------------------------------------------------------

export interface CaptureJobRowShape {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  input_kind: CaptureInputKind;
  input_name: string;
  input_ref: string;
  input_sha256: string;
  document_date: string | null;
  status: CaptureStatus;
  resulting_branch_id: UUID | null;
  reimport_of_job_id: UUID | null;
  target_branch_id: UUID | null;
  progress: CaptureJobProgress | null;
  llm_usage: CaptureJobLlmUsage | null;
  stats: CaptureJobStats | null;
  error: string | null;
  created_by: UUID;
  created_at: string;
  finished_at: string | null;
}

export function captureJobRowToWire(row: CaptureJobRowShape): CaptureJob {
  return {
    id: row.id,
    orgId: row.org_id,
    modelId: row.model_id,
    inputKind: row.input_kind,
    inputName: row.input_name,
    inputRef: row.input_ref,
    inputSha256: row.input_sha256,
    documentDate: row.document_date,
    status: row.status,
    resultingBranchId: row.resulting_branch_id,
    reimportOfJobId: row.reimport_of_job_id,
    targetBranchId: row.target_branch_id,
    progress: row.progress,
    llmUsage: row.llm_usage,
    stats: row.stats,
    error: row.error === null ? null : (JSON.parse(row.error) as CaptureJobError),
    createdBy: row.created_by,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

export function captureJobWireToRow(job: CaptureJob): CaptureJobRowShape {
  return {
    id: job.id,
    org_id: job.orgId,
    model_id: job.modelId,
    input_kind: job.inputKind,
    input_name: job.inputName,
    input_ref: job.inputRef,
    input_sha256: job.inputSha256,
    document_date: job.documentDate,
    status: job.status,
    resulting_branch_id: job.resultingBranchId,
    reimport_of_job_id: job.reimportOfJobId,
    target_branch_id: job.targetBranchId,
    progress: job.progress,
    llm_usage: job.llmUsage,
    stats: job.stats,
    error: job.error === null ? null : JSON.stringify(job.error),
    created_by: job.createdBy,
    created_at: job.createdAt,
    finished_at: job.finishedAt,
  };
}

export interface CaptureCandidateRowShape {
  id: UUID;
  org_id: UUID;
  job_id: UUID;
  model_id: UUID;
  seq: number;
  kind: 'element' | 'relationship';
  class: CandidateClass;
  element_type: ElementType | null;
  relationship_type: RelationshipType | null;
  draft_subject_id: UUID | null;
  proposal: CandidateProposal;
  evidence: CandidateEvidence;
  match: MatchOutcome;
  confidence: number;
  row_key: string;
  reimport_status: CandidateReimportStatus | null;
  draft_delta_ids: UUID[];
  decision: CandidateDecision | null;
  decision_detail: CandidateDecisionDetail | null;
  decided_by: UUID | null;
  decided_at: string | null;
  promoted_commit_id: UUID | null;
  promoted_subject_id: UUID | null;
  created_at: string;
}

export function captureCandidateRowToWire(row: CaptureCandidateRowShape): CaptureCandidate {
  return {
    id: row.id,
    orgId: row.org_id,
    jobId: row.job_id,
    modelId: row.model_id,
    seq: row.seq,
    kind: row.kind,
    class: row.class,
    elementType: row.element_type,
    relationshipType: row.relationship_type,
    draftSubjectId: row.draft_subject_id,
    proposal: row.proposal,
    evidence: row.evidence,
    match: row.match,
    confidence: row.confidence,
    rowKey: row.row_key,
    reimportStatus: row.reimport_status,
    draftDeltaIds: row.draft_delta_ids,
    decision: row.decision,
    decisionDetail: row.decision_detail,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    promotedCommitId: row.promoted_commit_id,
    promotedSubjectId: row.promoted_subject_id,
    createdAt: row.created_at,
  };
}

export function captureCandidateWireToRow(candidate: CaptureCandidate): CaptureCandidateRowShape {
  return {
    id: candidate.id,
    org_id: candidate.orgId,
    job_id: candidate.jobId,
    model_id: candidate.modelId,
    seq: candidate.seq,
    kind: candidate.kind,
    class: candidate.class,
    element_type: candidate.elementType,
    relationship_type: candidate.relationshipType,
    draft_subject_id: candidate.draftSubjectId,
    proposal: candidate.proposal,
    evidence: candidate.evidence,
    match: candidate.match,
    confidence: candidate.confidence,
    row_key: candidate.rowKey,
    reimport_status: candidate.reimportStatus,
    draft_delta_ids: candidate.draftDeltaIds,
    decision: candidate.decision,
    decision_detail: candidate.decisionDetail,
    decided_by: candidate.decidedBy,
    decided_at: candidate.decidedAt,
    promoted_commit_id: candidate.promotedCommitId,
    promoted_subject_id: candidate.promotedSubjectId,
    created_at: candidate.createdAt,
  };
}
