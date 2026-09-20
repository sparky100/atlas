/**
 * F2 (full K1) PR10/PR11, SPEC-capture.md §2/§5/§7/§8 step 3 ("no DB write
 * yet"): the one function §12 requires — parse → extract → match → classify
 * — for every input kind (spreadsheet/CSV, PDF, pasted text). `runCapture()`
 * dispatches on `source.format` to `runSheetCapture()` (PR1-PR9's modules:
 * parsing (`parse/*`), column mapping (`columnSynonyms`/`mapColumns`), row
 * extraction (`rowsToCandidates`), capability assignment
 * (`capabilityAssignment`)) or `runProseCapture()` (PR11's own `parse/pdf`,
 * `parse/pastedText`, `chunk`, `extractProse`) — both converge on the same
 * `RowCandidate[]` currency and the same `classifyAndResolve()` (matching
 * `match`/`matchIndex`, classification `classify`, re-import diff
 * `reimportDiff`, row keys `rowKey`). `capture-run` (the edge function,
 * PR12) is the only caller that turns this function's output into
 * `capture_jobs`/`capture_candidates` DB rows; this module knows nothing
 * about either table, which is why its own result type is `ResolvedCandidate`
 * rather than the persisted `CaptureCandidate` (no `id`/`orgId`/`jobId`/
 * `modelId`/`decision*`/`promoted*`/`createdAt` — none of those exist before
 * a job row does).
 *
 * Scope, disclosed:
 * - `aliasProposals` (§7.6): threaded through on every `ResolvedCandidate`
 *   (never dropped — `buildPromotionEnvelope.ts`'s own PR8 comment names
 *   this as "the orchestrator's own job (PR10) once it exists"), but not
 *   yet persisted onto a `capture_candidates` row — `CaptureCandidate`
 *   (PR1's contract) has no field for it today. Whether that needs a new
 *   column or can be derived some other way is PR12's own decision, made
 *   together with wiring `write_capture_draft` for real; this module's job
 *   is only to make sure the data survives this far, not to persist it.
 * - `unsourced` only ever comes from `runProseCapture()` — `RowCandidate.ungrounded`
 *   (set by `extractProse.ts` when a fact's defining passage doesn't
 *   ground) short-circuits `resolveElementCandidate`/`resolveRelationshipCandidate`
 *   before any matching is attempted, the same early-return shape
 *   `PARENT_UNRESOLVED` already has; a spreadsheet row is never `ungrounded`
 *   (`rowsToCandidates.ts` never sets the flag). `invalid` is narrowed to
 *   what either path can actually produce: an unresolved parent
 *   (`PARENT_UNRESOLVED`) or an unresolved relationship endpoint
 *   (`ENDPOINT_UNRESOLVED`) — required attributes and non-empty names are
 *   already guaranteed upstream (`rowsToCandidates.ts`'s own defaults; a
 *   blank-name row is never emitted as a candidate at all), and a
 *   within-run duplicate-triple collision (S-6, two rows proposing the
 *   exact same live edge) is rare enough at these fixture sizes to leave
 *   for a later PR rather than add here unexercised.
 * - Capability assignment (§6.3) runs once across every sheet's own
 *   `capabilityRows` combined, appending its own `supports` candidates
 *   after every sheet's own element/actor/relationship candidates — §4.5's
 *   own "row number, then fixed type order" ordering is followed within a
 *   sheet; interleaving a capability batch's own results back into each
 *   sheet's own row order would need restructuring `capabilityAssignment.ts`'s
 *   already-shipped per-call batching contract for no fixture-visible
 *   benefit, so this is a disclosed, simpler placement instead.
 * - A newly-created (this-run) capability with its own newly-created parent
 *   capability is not resolved recursively — no fixture in §12.2 creates a
 *   capability element at all (capture's own `capability` column role maps
 *   to a `supports` proposal via §6.3, never a capability sheet type in
 *   fixtures 01-07), so this narrowing has no observable effect here.
 * - `INPUT_ENCRYPTED` (`runProseCapture()`'s own `PdfPasswordProtectedError`
 *   branch) is reasoned through and unit-tested for the *parser*
 *   (`parse/pdf.ts`'s own `isPasswordException`), but has no test at this
 *   level — pdf-lib (the only PDF-writer this sandbox has) cannot produce an
 *   encrypted PDF, so no real fixture exists to exercise the branch here;
 *   the same disclosed gap `parse/pdf.test.ts` already names.
 */
import type { CandidateClass, CandidateProposal, CandidateReimportStatus, CaptureAliasType, CaptureJobStats, ElementProposal, EvidenceWarning, MatchOutcome, RelationshipProposal } from '../contracts/capture';
import type { CandidateEvidence } from '../contracts/capture';
import type { ElementType, RelationshipType, UUID } from '../contracts/delta';
import type { SourceRef } from '../contracts/sourceRef';
import { factMapKey, type Head } from '../engine/deltas';
import { assignCapabilities } from './capabilityAssignment';
import { chunkPastedText, chunkPdfPages, type PdfChunk, type PdfChunkPageRange, type TextChunk } from './chunk';
import type { ColumnRoleAssignment } from './columnSynonyms';
import { classifyAttribute, classifyElement, classifyRelationship, type AttributeComparisonInput, type AttributeOutcome } from './classify';
import { existenceConf, SHEET_CONFIDENCE_CAP } from './confidence';
import { extractProseChunk } from './extractProse';
import type { LlmClient } from './llm/client';
import { mapSheetColumns } from './mapColumns';
import { matchElement, resolveByTrigram, TOP_LEVEL_CONTEXT, type MatchContext } from './match';
import type { MatchIndex } from './matchIndex';
import { normaliseName } from './normalise';
import { parseCsv } from './parse/csv';
import { pageHasNoText, parsePdf, PdfParseError, PdfPasswordProtectedError } from './parse/pdf';
import { parsePastedText } from './parse/pastedText';
import { parseXlsxWorkbook, type ParsedSpreadsheetSheet } from './parse/spreadsheet';
import { dedupeIntraDocumentCandidates } from './intraDocumentDedup';
import { diffAgainstPreviousImport, type PreviousCandidateForDiff } from './reimportDiff';
import { elementRowKey, relationshipRowKey } from './rowKey';
import { rowsToCandidates, type CapabilityColumnRow, type RowCandidate } from './rowsToCandidates';

export class RunCaptureError extends Error {}

export type RunCaptureSource = { format: 'csv'; text: string } | { format: 'xlsx'; bytes: ArrayBuffer } | { format: 'pdf'; bytes: ArrayBuffer } | { format: 'text'; text: string };

export interface RunCaptureInput {
  inputName: string;
  source: RunCaptureSource;
  /** `capture_jobs.document_date` — every candidate's own `sourceCapturedAt` for §4.4's conflict-strength comparison. */
  documentDate: string | null;
  llmClient: LlmClient;
  /** §7.1's read set, already built by the caller (a real DB read in `capture-run`, PR12; `model.json` folded into one in the fixture harness). */
  matchIndex: MatchIndex;
  mainHead: Head;
  /** Present iff the job's own `reimport_of_job_id` is set (§9). */
  reimportPrevious?: readonly PreviousCandidateForDiff[];
  /** Every `new`-class candidate's own `draftSubjectId` (§8.1: the worker mints element/relationship ids before building the draft envelope) — delta ids are `buildCaptureDraftEnvelope.ts`'s own separate `mintId`, never this one. */
  mintId: () => UUID;
}

/** The business half of a `CaptureCandidate` (§4) — everything `buildCaptureDraftEnvelope.ts` and the review queue need, minus the job/org/model/decision bookkeeping only a real `capture_jobs` row gives a candidate (PR12's job). */
export interface ResolvedCandidate {
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
  aliasProposals: { type: CaptureAliasType; value: string }[];
}

export interface RunCaptureFailure {
  status: 'failed';
  errorCode: 'NO_USABLE_SHEET' | 'INPUT_TOO_LARGE' | 'INPUT_ENCRYPTED' | 'INPUT_UNREADABLE' | 'NO_TEXT_LAYER';
  message: string;
}

export interface RunCaptureSuccess {
  status: 'parsed';
  candidates: ResolvedCandidate[];
  /** Flat per §3.2's own already-fixed `CaptureJobStats = Record<string, number>` — the richer nested example in SPEC §8.1 doesn't fit that type (a PR1 decision, not this PR's to revisit), so this module reports the same counts flattened under `dot.separated` keys instead (`class.new`, `matchLevel.alias`, `warning.LOW_MAPPING_CONFIDENCE`, `sheet.skipped.SHEET_NO_HEADER`, `reimport.changed`, …). */
  stats: CaptureJobStats;
}

export type RunCaptureResult = RunCaptureFailure | RunCaptureSuccess;

// ---------------------------------------------------------------------------
// Sheet-type inference (§5.2 step 2's own closing paragraph).
// ---------------------------------------------------------------------------

const CONTAINER_SHEET_NAME_PATTERN = /\b(modules?|components?|containers?|services?)\b/i;
const CAPABILITY_SHEET_NAME_PATTERN = /\bcapabilit(y|ies)\b/i;
const ACTOR_SHEET_NAME_PATTERN = /\b(teams?|owners?|contacts?)\b/i;

/** §5.2: "system by default; container when a parent column resolves... or the sheet is named like Modules/…; capability when named like Capabilities/…; actor when named like Teams/…. The model's own `sheetType` is used only when the code heuristics are undecided." */
export function inferSheetType(sheetName: string, hasParentColumn: boolean, llmSheetType: ElementType | null): ElementType {
  if (hasParentColumn || CONTAINER_SHEET_NAME_PATTERN.test(sheetName)) return 'container';
  if (CAPABILITY_SHEET_NAME_PATTERN.test(sheetName)) return 'capability';
  if (ACTOR_SHEET_NAME_PATTERN.test(sheetName)) return 'actor';
  if (llmSheetType !== null) return llmSheetType;
  return 'system';
}

// ---------------------------------------------------------------------------
// Parsing.
// ---------------------------------------------------------------------------

function parseSheets(source: RunSheetCaptureInput['source'], inputName: string): ParsedSpreadsheetSheet[] {
  if (source.format === 'csv') {
    const baseName = inputName.replace(/\.[^./]+$/, '');
    return [parseCsv(source.text, baseName)];
  }
  return parseXlsxWorkbook(source.bytes);
}

function isBlankRow(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim() === '');
}

// ---------------------------------------------------------------------------
// §5.2 step 2: "records LOW_MAPPING_CONFIDENCE on every candidate from a
// column mapped below 0.70." `resolveColumnRoles`/`mapSheetColumns` compute
// this warning at the *sheet* level (one entry per low-confidence column,
// §11); `rowsToCandidates.ts` takes `roles` as a plain input and has no way
// to thread a sheet-level warning back onto the individual candidates it
// builds, so this orchestrator does it — for the roles that land on a
// single, plainly-named attribute (`vendor`, `isExternal`, …). `sourceKey`
// (an alias, not an attribute), `owner`/`technicalOwner` (a relationship,
// not this element's own attribute) and `parent`/`capability`/`usesSystems`/
// `flowsTo`/`integrationPlatform` (resolved into something other than a
// same-named attribute) are a disclosed narrower surface — nothing in
// fixtures 01-07 needs the warning attached through one of those roles.
// ---------------------------------------------------------------------------

const PLAIN_ATTRIBUTE_ROLES: ReadonlySet<string> = new Set(['description', 'vendor', 'technology', 'externalOrganisation', 'hostingProvider', 'lifecycleStatus', 'introduced', 'plannedEnd', 'isExternal', 'hostingModel']);

function attachLowMappingConfidenceWarnings(candidates: readonly RowCandidate[], sheetWarnings: readonly EvidenceWarning[], headers: readonly string[], roles: readonly (ColumnRoleAssignment | null)[]): RowCandidate[] {
  const lowConfidenceByRole = new Map<string, { column: string; confidence: number }>();
  for (const warning of sheetWarnings) {
    if (warning.code !== 'LOW_MAPPING_CONFIDENCE') continue;
    const headerIndex = headers.indexOf(warning.column);
    const role = headerIndex >= 0 ? roles[headerIndex]?.role : undefined;
    if (role !== undefined && PLAIN_ATTRIBUTE_ROLES.has(role)) lowConfidenceByRole.set(role, { column: warning.column, confidence: warning.confidence });
  }
  if (lowConfidenceByRole.size === 0) return [...candidates];

  return candidates.map((candidate) => {
    if (candidate.proposal.kind !== 'element') return candidate;
    const extraWarnings: EvidenceWarning[] = [];
    for (const attribute of Object.keys(candidate.evidence.attributeRefs ?? {})) {
      const hit = lowConfidenceByRole.get(attribute);
      if (hit) extraWarnings.push({ code: 'LOW_MAPPING_CONFIDENCE', column: hit.column, confidence: hit.confidence });
    }
    if (extraWarnings.length === 0) return candidate;
    return { ...candidate, evidence: { ...candidate.evidence, warnings: [...candidate.evidence.warnings, ...extraWarnings] } };
  });
}

// ---------------------------------------------------------------------------
// Seq offsetting — `rowsToCandidates()` numbers a sheet's own candidates
// from 0; every sheet after the first needs its own numbers shifted into a
// disjoint range before sheets are combined, since a `{kind:'candidate', seq}`
// ref is only ever meant to resolve within its own sheet's own run.
// ---------------------------------------------------------------------------

function offsetElementRef<T extends { kind: string }>(ref: T, offset: number): T {
  return ref.kind === 'candidate' ? { ...ref, seq: (ref as unknown as { seq: number }).seq + offset } : ref;
}

function offsetRowCandidate(candidate: RowCandidate, offset: number): RowCandidate {
  const proposal =
    candidate.proposal.kind === 'element'
      ? { ...candidate.proposal, parent: candidate.proposal.parent === null ? null : offsetElementRef(candidate.proposal.parent, offset) }
      : { ...candidate.proposal, from: offsetElementRef(candidate.proposal.from, offset), to: offsetElementRef(candidate.proposal.to, offset) };
  return { ...candidate, seq: candidate.seq + offset, proposal };
}

// ---------------------------------------------------------------------------
// Reference resolution (§7.4): an `unresolved` text ref resolves first
// against this run's own other candidates (exact normalised-name match —
// §5.3's own "resolved exactly as sheet unresolved refs are" note applies
// the same rule to a prose endpoint, so one function serves both), then
// against main via `resolveByTrigram` directly (bypassing `matchElement`'s
// own context filter — the same reasoning `capabilityAssignment.ts` already
// gives for why a *reference* lookup, "is there an element named X", is not
// a *context-checked match*, "is this candidate the same element as one
// already living under a known parent").
// ---------------------------------------------------------------------------

interface RunElementIndex {
  byType: Map<ElementType, RowCandidate[]>;
}

function buildRunElementIndex(candidates: readonly RowCandidate[]): RunElementIndex {
  const byType = new Map<ElementType, RowCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.proposal.kind !== 'element') continue;
    const bucket = byType.get(candidate.proposal.elementType);
    if (bucket) bucket.push(candidate);
    else byType.set(candidate.proposal.elementType, [candidate]);
  }
  return { byType };
}

/** Resolves free text (a `parent`, an endpoint, a `via`) against this run's own candidates first, then main — `null` when neither has anything. */
function resolveTextRef(text: string, expectedTypes: readonly ElementType[], runIndex: RunElementIndex, resolvedSubjectBySeq: ReadonlyMap<number, UUID | null>, matchIndex: MatchIndex, kindFilter?: (elementType: ElementType, attributes: Record<string, unknown>) => boolean): UUID | null {
  const normalised = normaliseName(text);
  for (const type of expectedTypes) {
    for (const candidate of runIndex.byType.get(type) ?? []) {
      if (candidate.proposal.kind !== 'element' || normaliseName(candidate.proposal.name) !== normalised) continue;
      if (kindFilter && !kindFilter(type, candidate.proposal.attributes)) continue;
      const resolved = resolvedSubjectBySeq.get(candidate.seq);
      if (resolved !== undefined && resolved !== null) return resolved;
    }
  }
  for (const type of expectedTypes) {
    let pool = matchIndex.elementsByType.get(type) ?? [];
    if (kindFilter) pool = pool.filter((el) => kindFilter(type, el.attributes as Record<string, unknown>));
    const hit = resolveByTrigram(text, pool);
    if (hit.level !== 'none' && hit.ambiguous === undefined && hit.elementId !== undefined) return hit.elementId;
  }
  return null;
}

const INTEGRATION_PLATFORM_FILTER = (elementType: ElementType, attributes: Record<string, unknown>): boolean => elementType === 'system' && attributes.kind === 'integration_platform';

// ---------------------------------------------------------------------------
// Row keys (§9.1) — needs each resolved subject's own identifying triple.
// For a run-minted candidate this is the document's own name/parent text;
// for a pre-existing main element (no run candidate proposed it — a plain
// relationship endpoint or `supports` target) it's main's own name/parent,
// since row_key's whole job is staying stable across re-import runs and a
// plain pre-existing reference has no document-stated identity of its own
// to prefer over that.
// ---------------------------------------------------------------------------

function mainElementRowKey(elementId: UUID, matchIndex: MatchIndex): string {
  const element = matchIndex.elements.get(elementId);
  if (!element) throw new RunCaptureError(`runCapture: internal — element ${elementId} referenced but not found in the match index.`);
  const parentName = element.parent_id !== null ? (matchIndex.elements.get(element.parent_id)?.name ?? null) : null;
  return elementRowKey({ elementType: element.element_type, name: element.name, parentName });
}

// ---------------------------------------------------------------------------
// Element resolution.
// ---------------------------------------------------------------------------

const REQUIRED_ATTRIBUTES_BY_TYPE: Readonly<Record<ElementType, readonly string[]>> = {
  system: ['lifecycleStatus', 'isExternal'],
  container: ['isExternal'],
  actor: ['subtype', 'isExternal'],
  capability: [],
};

function attributeComparisons(attributes: Readonly<Record<string, unknown>>, attributeConfidence: Readonly<Record<string, number>>, subjectId: UUID | undefined, mainHead: Head, sourceCapturedAt: string | null): Map<string, AttributeComparisonInput> {
  const comparisons = new Map<string, AttributeComparisonInput>();
  for (const [attribute, value] of Object.entries(attributes)) {
    const fact = subjectId !== undefined ? mainHead.facts.get(factMapKey(subjectId, attribute)) : undefined;
    const mainFact = fact ? { value: fact.value, confidence: fact.confidence, effectiveOrAssertedDate: fact.effectiveDate ?? fact.createdAt } : undefined;
    comparisons.set(attribute, { proposedValue: value, proposedConfidence: attributeConfidence[attribute] ?? 0, mainFact, sourceCapturedAt });
  }
  return comparisons;
}

/** §4.4's own "confirm re-asserts every proposed attribute (K-6); update/conflict/ambiguous only the differing ones" rule — computed once here so `buildCaptureDraftEnvelope.ts` (which trusts `proposal.attributes` exactly as given) never has to re-decide it. */
function filterAttributesForClass(attributes: Readonly<Record<string, unknown>>, cls: CandidateClass, outcomes: ReadonlyMap<string, AttributeOutcome>): Record<string, unknown> {
  if (cls === 'new' || cls === 'confirm') return { ...attributes };
  return Object.fromEntries(Object.entries(attributes).filter(([key]) => outcomes.get(key) !== 'confirm'));
}

interface ElementResolutionResult {
  class: CandidateClass;
  match: MatchOutcome;
  draftSubjectId: UUID | null;
  attributes: Record<string, unknown>;
  extraWarning?: EvidenceWarning;
  parentNameForRowKey: string | null;
  /** The candidate's own `parent` ref, fully resolved (`null` for a top-level element) — the caller writes this back into the output `proposal.parent` as `{kind:'existing', elementId}`, since `buildCaptureDraftEnvelope.ts` requires every ref already resolved by the time it sees a candidate. */
  resolvedParentElementId: UUID | null;
}

/** Resolves one element candidate's own `parent` ref (system/actor never have one — `context` is unconditionally top-level for them per `match.ts`'s own `contextMatches`) and matches/classifies it against main. */
function resolveElementCandidate(candidate: RowCandidate, proposal: ElementProposal, runIndex: RunElementIndex, resolvedSubjectBySeq: ReadonlyMap<number, UUID | null>, matchIndex: MatchIndex, mainHead: Head, sourceCapturedAt: string | null, mintId: () => UUID): ElementResolutionResult {
  if (candidate.ungrounded) {
    return {
      class: 'unsourced',
      match: { level: 'none', score: 0, similar: [], warnings: [] },
      draftSubjectId: null,
      attributes: proposal.attributes,
      parentNameForRowKey: proposal.parent?.kind === 'unresolved' ? proposal.parent.text : null,
      resolvedParentElementId: null,
    };
  }

  let contextElementId: MatchContext = TOP_LEVEL_CONTEXT;
  let parentNameForRowKey: string | null = null;
  let resolvedParentElementId: UUID | null = null;

  if (proposal.parent !== null) {
    if (proposal.parent.kind !== 'unresolved') {
      throw new RunCaptureError(`seq ${String(candidate.seq)}: an element candidate's own parent must be 'unresolved' text at this stage (rowsToCandidates.ts never emits any other shape).`);
    }
    parentNameForRowKey = proposal.parent.text;
    const parentType: ElementType = proposal.elementType === 'capability' ? 'capability' : 'system';
    const resolvedParentId = resolveTextRef(proposal.parent.text, [parentType], runIndex, resolvedSubjectBySeq, matchIndex);
    if (resolvedParentId === null) {
      return {
        class: 'invalid',
        match: { level: 'none', score: 0, similar: [], warnings: [] },
        draftSubjectId: null,
        attributes: proposal.attributes,
        extraWarning: { code: 'PARENT_UNRESOLVED', text: proposal.parent.text },
        parentNameForRowKey,
        resolvedParentElementId: null,
      };
    }
    contextElementId = resolvedParentId;
    resolvedParentElementId = resolvedParentId;
  }

  const match = matchElement(
    {
      name: proposal.name,
      elementType: proposal.elementType,
      ...(candidate.matchHints?.atlasId !== undefined ? { atlasId: candidate.matchHints.atlasId } : {}),
      ...(candidate.matchHints?.sourceKeys !== undefined ? { sourceKeys: candidate.matchHints.sourceKeys } : {}),
      context: proposal.parent === null ? TOP_LEVEL_CONTEXT : contextElementId,
    },
    matchIndex,
  );

  if (match.level === 'none') {
    const attributes = proposal.attributes as Record<string, unknown>;
    return { class: 'new', match, draftSubjectId: mintId(), attributes, parentNameForRowKey, resolvedParentElementId };
  }

  const matchedElementId = match.elementId;
  if (matchedElementId === undefined) throw new RunCaptureError(`seq ${String(candidate.seq)}: internal — a match outcome above 'none' always carries an elementId.`);

  const comparisons = attributeComparisons(proposal.attributes, candidate.evidence.attributeConfidence, matchedElementId, mainHead, sourceCapturedAt);
  const cls = classifyElement({ match, attributes: [...comparisons.values()] });
  const outcomes = new Map<string, AttributeOutcome>([...comparisons].map(([key, input]) => [key, classifyAttribute(input)]));
  const attributes = filterAttributesForClass(proposal.attributes, cls, outcomes);

  return { class: cls, match, draftSubjectId: matchedElementId, attributes, parentNameForRowKey, resolvedParentElementId };
}

// ---------------------------------------------------------------------------
// Relationship resolution.
// ---------------------------------------------------------------------------

/**
 * `uses`/`flows_to` endpoints may be system or container (§6.2's own
 * prompt-B description). For a *sheet* row, `owns`/`supports` endpoints
 * are always already resolved (to a candidate seq or an existing main id)
 * by `rowsToCandidates.ts`/`capabilityAssignment.ts` themselves, so this
 * list never actually gets consulted for them from that path — but
 * `extractProse.ts` (PR11) leaves *every* relationship's own `from`/`to`
 * as `{kind:'unresolved', text}` uniformly (§5.3: "resolved exactly as
 * sheet unresolved refs are"), `owns`'s own actor `from` endpoint
 * included, so `owns` genuinely needs `actor` in its own list too — one
 * shared list per relationship type, not per end, since `resolveEndpointRef`
 * doesn't distinguish `from` from `to` when it searches (searching one
 * type bucket that doesn't contain a real hit is a no-op, never a false
 * match against a different bucket).
 */
const ENDPOINT_TYPES_BY_RELATIONSHIP: Readonly<Record<RelationshipType, readonly ElementType[]>> = {
  supports: ['capability'],
  uses: ['system', 'container'],
  owns: ['actor', 'system', 'container', 'capability'],
  flows_to: ['system', 'container'],
};

interface ResolvedEndpoint {
  elementId: UUID | null;
  warning?: EvidenceWarning;
}

function resolveEndpointRef(ref: RelationshipProposal['from'], relationshipType: RelationshipType, end: 'from' | 'to', runIndex: RunElementIndex, resolvedSubjectBySeq: ReadonlyMap<number, UUID | null>, matchIndex: MatchIndex): ResolvedEndpoint {
  if (ref.kind === 'existing') return { elementId: ref.elementId };
  if (ref.kind === 'candidate') {
    const resolved = resolvedSubjectBySeq.get(ref.seq);
    if (resolved === undefined) throw new RunCaptureError(`internal — candidate seq ${String(ref.seq)} referenced before it was resolved.`);
    return resolved === null ? { elementId: null, warning: { code: 'ENDPOINT_UNRESOLVED', text: `(candidate seq ${String(ref.seq)})`, end } } : { elementId: resolved };
  }
  const resolvedId = resolveTextRef(ref.text, ENDPOINT_TYPES_BY_RELATIONSHIP[relationshipType], runIndex, resolvedSubjectBySeq, matchIndex);
  return resolvedId === null ? { elementId: null, warning: { code: 'ENDPOINT_UNRESOLVED', text: ref.text, end } } : { elementId: resolvedId };
}

interface RelationshipResolutionResult {
  class: CandidateClass;
  match: MatchOutcome;
  draftSubjectId: UUID | null;
  fromElementId: UUID | null;
  toElementId: UUID | null;
  attributes: Record<string, unknown>;
  extraWarnings: EvidenceWarning[];
}

const NO_MATCH_OUTCOME: MatchOutcome = { level: 'none', score: 0, similar: [], warnings: [] };

function resolveRelationshipCandidate(
  candidate: RowCandidate,
  proposal: RelationshipProposal,
  runIndex: RunElementIndex,
  resolvedSubjectBySeq: ReadonlyMap<number, UUID | null>,
  matchIndex: MatchIndex,
  mainHead: Head,
  relationshipIndex: ReadonlyMap<string, UUID>,
  sourceCapturedAt: string | null,
  mintId: () => UUID,
): RelationshipResolutionResult {
  if (candidate.ungrounded) {
    return { class: 'unsourced', match: NO_MATCH_OUTCOME, draftSubjectId: null, fromElementId: null, toElementId: null, attributes: proposal.attributes as Record<string, unknown>, extraWarnings: [] };
  }

  const from = resolveEndpointRef(proposal.from, proposal.relationshipType, 'from', runIndex, resolvedSubjectBySeq, matchIndex);
  const to = resolveEndpointRef(proposal.to, proposal.relationshipType, 'to', runIndex, resolvedSubjectBySeq, matchIndex);
  const extraWarnings: EvidenceWarning[] = [from.warning, to.warning].filter((w): w is EvidenceWarning => w !== undefined);

  if (from.elementId === null || to.elementId === null) {
    return { class: 'invalid', match: NO_MATCH_OUTCOME, draftSubjectId: null, fromElementId: from.elementId, toElementId: to.elementId, attributes: proposal.attributes as Record<string, unknown>, extraWarnings };
  }

  let attributes: Record<string, unknown> = { ...(proposal.attributes as Record<string, unknown>) };
  const viaHint = candidate.viaHint;
  if (viaHint !== undefined) {
    const viaId = resolveTextRef(viaHint, ['system'], runIndex, resolvedSubjectBySeq, matchIndex, INTEGRATION_PLATFORM_FILTER);
    if (viaId !== null) attributes = { ...attributes, via: viaId };
    // §7.4/§5.2: an unresolved `via` is dropped, never invalidating (`via` is optional) — no warning code is defined for it in §4's own EvidenceWarning union, unlike a genuine endpoint.
  }

  const existingRelationshipId = relationshipIndex.get(`${proposal.relationshipType}|${from.elementId}|${to.elementId}`);
  if (existingRelationshipId === undefined) {
    return { class: 'new', match: NO_MATCH_OUTCOME, draftSubjectId: mintId(), fromElementId: from.elementId, toElementId: to.elementId, attributes, extraWarnings };
  }

  const comparisons = attributeComparisons(attributes, candidate.evidence.attributeConfidence, existingRelationshipId, mainHead, sourceCapturedAt);
  const cls = classifyRelationship({ existingRelationship: { attributes: [...comparisons.values()] } });
  const outcomes = new Map<string, AttributeOutcome>([...comparisons].map(([key, input]) => [key, classifyAttribute(input)]));
  const filtered = filterAttributesForClass(attributes, cls, outcomes);

  return { class: cls, match: NO_MATCH_OUTCOME, draftSubjectId: existingRelationshipId, fromElementId: from.elementId, toElementId: to.elementId, attributes: filtered, extraWarnings };
}

function buildRelationshipIndex(head: Head): Map<string, UUID> {
  const index = new Map<string, UUID>();
  for (const [id, row] of head.relationships) index.set(`${row.relationshipType}|${row.fromElementId}|${row.toElementId}`, id);
  return index;
}

// ---------------------------------------------------------------------------
// Confidence for a `new` candidate (§5.5's own `existenceConf`/`candidateConf`).
// ---------------------------------------------------------------------------

/** §5.5: `candidateConf = existenceConf` — computed the same way for every class, elements only ("min over {name, required attributes present}"); a matched candidate's own per-attribute *delta* confidence (`updateConf`, capped by match confidence) is a separate, lower-level number `buildCaptureDraftEnvelope.ts` computes itself, not this one. */
function elementCandidateConfidence(elementType: ElementType, attributeConfidence: Readonly<Record<string, number>>): number {
  const required = ['name', ...REQUIRED_ATTRIBUTES_BY_TYPE[elementType]];
  return existenceConf(required.map((key) => attributeConfidence[key] ?? 0));
}

/** A relationship candidate has no §5.4 "required attributes" list to floor on — `owns`/`supports` carry their own `role` confidence; `uses`/`flows_to` carry none at all (`rowsToCandidates.ts` never populates one for them, having nothing but the mapped column's own already-1.0 synonym confidence to report). Disclosed fallback: `SHEET_CONFIDENCE_CAP` when nothing more specific was recorded, rather than `existenceConf`'s own "no inputs" floor of 0, which would understate a plain, unremarkable `uses`/`flows_to` row. */
function relationshipCandidateConfidence(attributeConfidence: Readonly<Record<string, number>>): number {
  const values = Object.values(attributeConfidence);
  return values.length > 0 ? existenceConf(values) : SHEET_CONFIDENCE_CAP;
}

// ---------------------------------------------------------------------------
// The orchestrator.
// ---------------------------------------------------------------------------

const MAX_ROWS = 5000;
const SAMPLE_ROW_COUNT = 5;

interface RunSheetCaptureInput extends Omit<RunCaptureInput, 'source'> {
  source: { format: 'csv'; text: string } | { format: 'xlsx'; bytes: ArrayBuffer };
}

interface RunProseCaptureInput extends Omit<RunCaptureInput, 'source'> {
  source: { format: 'pdf'; bytes: ArrayBuffer } | { format: 'text'; text: string };
}

export async function runCapture(input: RunCaptureInput): Promise<RunCaptureResult> {
  const { source } = input;
  if (source.format === 'pdf' || source.format === 'text') {
    return runProseCapture({ ...input, source });
  }
  return runSheetCapture({ ...input, source });
}

// ---------------------------------------------------------------------------
// Spreadsheet/CSV path (§5.2, §12's own fixtures 01-07).
// ---------------------------------------------------------------------------

async function runSheetCapture(input: RunSheetCaptureInput): Promise<RunCaptureResult> {
  const { inputName, source, documentDate, llmClient, matchIndex, mainHead, reimportPrevious, mintId } = input;
  const stats: Record<string, number> = {};
  const bumpStat = (key: string): void => { bump(stats, key); };

  const parsedSheets = parseSheets(source, inputName);

  let combined: RowCandidate[] = [];
  let capabilityRows: CapabilityColumnRow[] = [];
  let usableSheetCount = 0;
  let seqOffset = 0;
  let totalRows = 0;

  for (const sheet of parsedSheets) {
    if (sheet.headerRowIndex === null || sheet.rawSheet === null) {
      bumpStat('sheet.skipped.SHEET_NO_HEADER');
      continue;
    }
    const rawSheet = sheet.rawSheet;
    const headerRowIndex = sheet.headerRowIndex;
    const bodyRows = rawSheet.grid.slice(headerRowIndex + 1).filter((row) => !isBlankRow(row));
    totalRows += bodyRows.length;
    if (totalRows > MAX_ROWS) {
      return { status: 'failed', errorCode: 'INPUT_TOO_LARGE', message: `Workbook has more than ${String(MAX_ROWS)} data rows (K-16).` };
    }

    const mapped = await mapSheetColumns({
      llmClient,
      inputName,
      sheetName: sheet.sheetName,
      rowCount: bodyRows.length,
      headers: sheet.headers,
      headerColumnRefs: sheet.headerColumnRefs,
      sampleRows: bodyRows.slice(0, SAMPLE_ROW_COUNT),
    });
    for (const warning of mapped.warnings) bumpStat(`warning.${warning.code}`);

    if (mapped.nameColumnIndex === null) {
      bumpStat('sheet.skipped.SHEET_NO_NAME_COLUMN');
      continue;
    }

    const hasParentColumn = mapped.roles.some((r) => r?.role === 'parent');
    const llmSheetType = mapped.llmSheetType !== null && mapped.llmSheetType !== 'unknown' ? mapped.llmSheetType : null;
    const sheetType = inferSheetType(sheet.sheetName, hasParentColumn, llmSheetType);
    bumpStat(`sheet.type.${sheetType}`);
    usableSheetCount++;

    const { candidates: rawCandidates, capabilityRows: rawCapabilityRows } = rowsToCandidates({
      sheetName: sheet.sheetName,
      sheetType,
      headers: sheet.headers,
      headerColumnRefs: sheet.headerColumnRefs,
      roles: mapped.roles,
      nameColumnIndex: mapped.nameColumnIndex,
      rawSheet,
      headerRowIndex,
    });

    const { candidates: deduped, seqRemap } = dedupeIntraDocumentCandidates(rawCandidates);
    const remappedCapabilityRows = rawCapabilityRows.map((row) => ({ ...row, seq: seqRemap.get(row.seq) ?? row.seq }));
    const withLowConfidenceWarnings = attachLowMappingConfidenceWarnings(deduped, mapped.warnings, sheet.headers, mapped.roles);

    const localMaxSeqExclusive = rawCandidates.length;
    combined = combined.concat(withLowConfidenceWarnings.map((c) => offsetRowCandidate(c, seqOffset)));
    capabilityRows = capabilityRows.concat(remappedCapabilityRows.map((row) => ({ ...row, seq: row.seq + seqOffset })));
    seqOffset += localMaxSeqExclusive;
  }

  if (usableSheetCount === 0) {
    return { status: 'failed', errorCode: 'NO_USABLE_SHEET', message: 'No sheet in the workbook had both a usable header row and a resolvable name column.' };
  }

  if (capabilityRows.length > 0) {
    const { candidates: supportsCandidates } = await assignCapabilities({ rows: capabilityRows, matchIndex, llmClient, startSeq: seqOffset });
    combined = combined.concat(supportsCandidates);
  }

  return classifyAndResolve(combined, matchIndex, mainHead, documentDate, reimportPrevious, mintId, stats);
}

// ---------------------------------------------------------------------------
// PDF / pasted-text path (§5.3, §12's own fixtures 08-10 — PR13).
// ---------------------------------------------------------------------------

const MAX_PDF_PAGES = 200;
const MAX_TEXT_CHARS = 200000;

/** §5.3/§4.1: translates an offset pair within one `PdfChunk.text` back into a real page + page-local span — the page containing `start` decides the page; a passage that (rarely) crosses a page join is clamped to that same page's own end, since a `SourceRef.pdf` names exactly one page. `chunk.ts`'s own module comment names this translation as the caller's job. */
function pdfChunkSourceRefFor(chunk: PdfChunk, start: number, end: number): SourceRef {
  const range: PdfChunkPageRange | undefined = chunk.pageRanges.find((r) => start >= r.start && start < r.end) ?? chunk.pageRanges[chunk.pageRanges.length - 1];
  if (!range) throw new RunCaptureError('pdfChunkSourceRefFor: internal — chunkPdfPages never produces a chunk with no page ranges.');
  const clampedEnd = Math.max(Math.min(end, range.end), start);
  return { kind: 'pdf', page: range.page, start: start - range.start, end: clampedEnd - range.start };
}

/** `TextChunk.start`/`end` are already offsets into the whole pasted-text document — no page structure to resolve. */
function textChunkSourceRefFor(chunk: TextChunk, start: number, end: number): SourceRef {
  return { kind: 'text', start: chunk.start + start, end: chunk.start + end };
}

type ProseChunkEntry = { kind: 'pdf'; chunk: PdfChunk } | { kind: 'text'; chunk: TextChunk };

async function runProseCapture(input: RunProseCaptureInput): Promise<RunCaptureResult> {
  const { inputName, source, llmClient, matchIndex, mainHead, documentDate, reimportPrevious, mintId } = input;
  const stats: Record<string, number> = {};

  let chunkEntries: ProseChunkEntry[];

  if (source.format === 'pdf') {
    let parsed;
    try {
      parsed = await parsePdf(source.bytes);
    } catch (e) {
      if (e instanceof PdfPasswordProtectedError) return { status: 'failed', errorCode: 'INPUT_ENCRYPTED', message: e.message };
      if (e instanceof PdfParseError) return { status: 'failed', errorCode: 'INPUT_UNREADABLE', message: e.message };
      throw e;
    }
    if (parsed.pages.length > MAX_PDF_PAGES) {
      return { status: 'failed', errorCode: 'INPUT_TOO_LARGE', message: `PDF has more than ${String(MAX_PDF_PAGES)} pages (K-16).` };
    }
    if (parsed.pages.length > 0 && parsed.pages.every((p) => pageHasNoText(p))) {
      return { status: 'failed', errorCode: 'NO_TEXT_LAYER', message: "This PDF is scanned. Capture can't read images yet (§15); export the text or paste it." };
    }
    chunkEntries = chunkPdfPages(parsed.pages.map((p) => ({ page: p.page, text: p.text }))).map((chunk) => ({ kind: 'pdf' as const, chunk }));
  } else {
    const parsedText = parsePastedText(source.text);
    if (parsedText.charCount > MAX_TEXT_CHARS) {
      return { status: 'failed', errorCode: 'INPUT_TOO_LARGE', message: `Pasted text has more than ${String(MAX_TEXT_CHARS)} characters (K-16).` };
    }
    chunkEntries = chunkPastedText(parsedText.text).map((chunk) => ({ kind: 'text' as const, chunk }));
  }

  let combined: RowCandidate[] = [];
  let seqOffset = 0;
  let priorElementNames: string[] = [];

  for (const entry of chunkEntries) {
    const location = entry.kind === 'pdf' ? ({ kind: 'pages', first: entry.chunk.firstPage, last: entry.chunk.lastPage, total: entry.chunk.totalPages } as const) : ({ kind: 'pastedText', start: entry.chunk.start, end: entry.chunk.end, total: entry.chunk.total } as const);
    const sourceRefForOffset = entry.kind === 'pdf' ? (start: number, end: number): SourceRef => pdfChunkSourceRefFor(entry.chunk, start, end) : (start: number, end: number): SourceRef => textChunkSourceRefFor(entry.chunk, start, end);

    // Each chunk's own prompt-B call names the previous chunks' own extracted element names (§6.2), so chunks are inherently sequential, not parallelisable.
    const { candidates, elementNames } = await extractProseChunk({ llmClient, inputName, location, chunkText: entry.chunk.text, priorElementNames, sourceRefForOffset });

    combined = combined.concat(candidates.map((c) => offsetRowCandidate(c, seqOffset)));
    seqOffset += candidates.length;
    priorElementNames = [...priorElementNames, ...elementNames];
    bump(stats, 'chunks');
  }

  // §5.2's own "Intra-document duplicates" pass (`intraDocumentDedup.ts`) is extractor-agnostic — reused here across the whole document's own chunks, not per-chunk, since the same element can plausibly recur across chunk boundaries despite §6.2's own "do not re-emit" instruction to the model.
  const { candidates: deduped } = dedupeIntraDocumentCandidates(combined);

  return classifyAndResolve(deduped, matchIndex, mainHead, documentDate, reimportPrevious, mintId, stats);
}

// ---------------------------------------------------------------------------
// Classification + resolution, over the whole combined run: elements with no
// parent (system/actor — no context dependency) first, then elements with a
// parent (container — may depend on a phase-1 candidate's own resolved
// subject), then relationships (may depend on either phase's own resolved
// subjects) — §7.4's own dependency order, not `combined`'s own seq order.
// The *output* order is `combined`'s own seq order regardless (§4.5),
// restored at the very end.
// ---------------------------------------------------------------------------

function classifyAndResolve(combined: readonly RowCandidate[], matchIndex: MatchIndex, mainHead: Head, documentDate: string | null, reimportPrevious: readonly PreviousCandidateForDiff[] | undefined, mintId: () => UUID, stats: Record<string, number>): RunCaptureResult {
  const runIndex = buildRunElementIndex(combined);
  const relationshipIndex = buildRelationshipIndex(mainHead);

  const resolvedSubjectBySeq = new Map<number, UUID | null>();
  const seqByElementId = new Map<UUID, number>();
  const rowKeyBySeq = new Map<number, string>();
  const built = new Map<number, ResolvedCandidate>();

  const elementsNoParent = combined.filter((c): c is RowCandidate & { proposal: ElementProposal } => c.proposal.kind === 'element' && c.proposal.parent === null);
  const elementsWithParent = combined.filter((c): c is RowCandidate & { proposal: ElementProposal } => c.proposal.kind === 'element' && c.proposal.parent !== null);
  const relationships = combined.filter((c): c is RowCandidate & { proposal: RelationshipProposal } => c.proposal.kind === 'relationship');

  const resolveOneElement = (candidate: RowCandidate & { proposal: ElementProposal }): void => {
    const result = resolveElementCandidate(candidate, candidate.proposal, runIndex, resolvedSubjectBySeq, matchIndex, mainHead, documentDate, mintId);
    resolvedSubjectBySeq.set(candidate.seq, result.draftSubjectId);
    if (result.draftSubjectId !== null) seqByElementId.set(result.draftSubjectId, candidate.seq);

    const rowKey = elementRowKey({
      elementType: candidate.proposal.elementType,
      name: candidate.proposal.name,
      parentName: result.parentNameForRowKey,
      ...(candidate.matchHints?.atlasId !== undefined ? { atlasId: candidate.matchHints.atlasId } : {}),
      ...(candidate.matchHints?.sourceKeys !== undefined ? { sourceKeys: candidate.matchHints.sourceKeys } : {}),
    });
    rowKeyBySeq.set(candidate.seq, rowKey);

    const warnings = result.extraWarning ? [...candidate.evidence.warnings, result.extraWarning] : candidate.evidence.warnings;
    const parent: ElementProposal['parent'] = result.resolvedParentElementId !== null ? { kind: 'existing', elementId: result.resolvedParentElementId } : null;
    const proposal: ElementProposal = { ...candidate.proposal, parent, attributes: result.attributes };
    const confidence = elementCandidateConfidence(candidate.proposal.elementType, candidate.evidence.attributeConfidence);

    built.set(candidate.seq, {
      seq: candidate.seq,
      kind: 'element',
      class: result.class,
      elementType: candidate.proposal.elementType,
      relationshipType: null,
      draftSubjectId: result.draftSubjectId,
      proposal,
      evidence: { ...candidate.evidence, warnings },
      match: result.match,
      confidence,
      rowKey,
      reimportStatus: null,
      aliasProposals: candidate.aliasProposals,
    });
    bump(stats, `class.${result.class}`);
    bump(stats, 'kind.element');
    bump(stats, `matchLevel.${result.match.level}`);
  };

  for (const candidate of elementsNoParent) resolveOneElement(candidate);
  for (const candidate of elementsWithParent) resolveOneElement(candidate);

  const rowKeyForElementId = (elementId: UUID): string => {
    const seq = seqByElementId.get(elementId);
    if (seq !== undefined) {
      const rowKey = rowKeyBySeq.get(seq);
      if (rowKey !== undefined) return rowKey;
    }
    return mainElementRowKey(elementId, matchIndex);
  };

  for (const candidate of relationships) {
    const result = resolveRelationshipCandidate(candidate, candidate.proposal, runIndex, resolvedSubjectBySeq, matchIndex, mainHead, relationshipIndex, documentDate, mintId);
    const fromKey = result.fromElementId !== null ? rowKeyForElementId(result.fromElementId) : (candidate.proposal.from.kind === 'unresolved' ? `unresolved:${candidate.proposal.from.text}` : 'unresolved:?');
    const toKey = result.toElementId !== null ? rowKeyForElementId(result.toElementId) : (candidate.proposal.to.kind === 'unresolved' ? `unresolved:${candidate.proposal.to.text}` : 'unresolved:?');
    const rowKey = relationshipRowKey(candidate.proposal.relationshipType, fromKey, toKey);

    const proposal: RelationshipProposal = { ...candidate.proposal, from: result.fromElementId !== null ? { kind: 'existing', elementId: result.fromElementId } : candidate.proposal.from, to: result.toElementId !== null ? { kind: 'existing', elementId: result.toElementId } : candidate.proposal.to, attributes: result.attributes };
    const warnings = result.extraWarnings.length > 0 ? [...candidate.evidence.warnings, ...result.extraWarnings] : candidate.evidence.warnings;
    const confidence = result.class === 'invalid' ? 0 : relationshipCandidateConfidence(candidate.evidence.attributeConfidence);

    built.set(candidate.seq, {
      seq: candidate.seq,
      kind: 'relationship',
      class: result.class,
      elementType: null,
      relationshipType: candidate.proposal.relationshipType,
      draftSubjectId: result.draftSubjectId,
      proposal,
      evidence: { ...candidate.evidence, warnings },
      match: result.match,
      confidence,
      rowKey,
      reimportStatus: null,
      aliasProposals: candidate.aliasProposals,
    });
    bump(stats, `class.${result.class}`);
    bump(stats, 'kind.relationship');
  }

  // §9.2 (PR9): re-import diff, when this job names a previous run.
  const goneResolved: ResolvedCandidate[] = [];
  if (reimportPrevious) {
    const thisRun = [...built.values()].filter((c) => c.class !== 'invalid').map((c) => ({ rowKey: c.rowKey, proposal: c.proposal }));
    const diff = diffAgainstPreviousImport(thisRun, reimportPrevious, matchIndex);
    for (const [seq, candidate] of built) {
      built.set(seq, { ...candidate, reimportStatus: diff.reimportStatusByRowKey.get(candidate.rowKey) ?? null });
      bump(stats, `reimport.${diff.reimportStatusByRowKey.get(candidate.rowKey) ?? 'new'}`);
    }
    for (const gone of diff.goneCandidates) {
      goneResolved.push({
        seq: -1,
        kind: 'element',
        class: 'gone',
        elementType: gone.elementType,
        relationshipType: null,
        draftSubjectId: gone.match.elementId ?? null,
        proposal: gone.proposal,
        evidence: gone.evidence,
        match: gone.match,
        confidence: gone.confidence,
        rowKey: gone.rowKey,
        reimportStatus: 'gone',
        aliasProposals: [],
      });
      bump(stats, 'class.gone');
      bump(stats, 'reimport.gone');
    }
  }

  const ordered = [...combined.map((c) => built.get(c.seq)).filter((c): c is ResolvedCandidate => c !== undefined), ...goneResolved];
  const candidates = ordered.map((c, index) => ({ ...c, seq: index }));
  bump(stats, 'candidates', candidates.length);

  return { status: 'parsed', candidates, stats };
}

function bump(stats: Record<string, number>, key: string, by = 1): void {
  stats[key] = (stats[key] ?? 0) + by;
}


