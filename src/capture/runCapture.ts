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
 *   this as "the orchestrator's own job (PR10) once it exists"), and now
 *   persisted onto `capture_candidates.alias_proposals` and shown in the
 *   review queue (`captureRunStep.ts`'s `toCaptureCandidate`, issue #284) —
 *   §7.6's own name-match/sourceKey/intra-document-group aliases only;
 *   this module never adds a level-3-name-match alias itself (§7.6's
 *   "level 3 match on name" row) — `resolveElementCandidate` doesn't
 *   append one on a `name_context` match, so a candidate proposing that
 *   alias never carries it. Extending matching to actually produce it is
 *   a separate, smaller gap than persisting what already exists, and not
 *   part of this fix.
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
import type { ActorSubtype, ElementType, OwnsRole, RelationshipType, UUID } from '../contracts/delta';
import type { SourceRef } from '../contracts/sourceRef';
import { factMapKey, type Head } from '../engine/deltas';
import { assignCapabilities } from './capabilityAssignment';
import { chunkPastedText, chunkPdfPages, type PdfChunk, type PdfChunkPageRange, type TextChunk } from './chunk';
import type { ColumnRoleAssignment } from './columnSynonyms';
import { classifyAttribute, classifyElement, classifyRelationship, type AttributeComparisonInput, type AttributeOutcome } from './classify';
import { DEFAULTED_ATTRIBUTE_CONFIDENCE, existenceConf, SHEET_CONFIDENCE_CAP } from './confidence';
import { extractProseChunk } from './extractProse';
import type { ImportChangeRow } from './importChangeRow';
import type { ImportRelationshipRow } from './importRelationshipRow';
import type { ImportRow, OwnerReference } from './importRowSchema';
import type { LlmClient } from './llm/client';
import { mapSheetColumns } from './mapColumns';
import { matchElement, resolveByTrigram, TOP_LEVEL_CONTEXT, type MatchContext } from './match';
import { buildTargetOnlyMatchIndex, type MatchIndex } from './matchIndex';
import { normaliseName } from './normalise';
import { looksLikePersonName } from './normaliseValue';
import { parseCsv } from './parse/csv';
import { pageHasNoText, parsePdf, PdfParseError, PdfPasswordProtectedError } from './parse/pdf';
import { parsePastedText } from './parse/pastedText';
import { parseXlsxWorkbook, type ParsedSpreadsheetSheet } from './parse/spreadsheet';
import { dedupeIntraDocumentCandidates, mergeSameNamedActors } from './intraDocumentDedup';
import { ImportFileParseError } from './parseImportFile';
import { parseImportJsonText } from './parseImportJson';
import { diffAgainstPreviousImport, type PreviousCandidateForDiff } from './reimportDiff';
import { isRelationshipsSheet, relationshipSheetToCandidates } from './relationshipSheetToCandidates';
import { elementRowKey, relationshipRowKey } from './rowKey';
import { applyRequiredDefaults, rowsToCandidates, type CapabilityColumnRow, type RowCandidate } from './rowsToCandidates';

export class RunCaptureError extends Error {}

export type RunCaptureSource = { format: 'csv'; text: string } | { format: 'xlsx'; bytes: ArrayBuffer } | { format: 'pdf'; bytes: ArrayBuffer } | { format: 'text'; text: string } | { format: 'json'; text: string };

export interface RunCaptureInput {
  inputName: string;
  source: RunCaptureSource;
  /** `capture_jobs.document_date` — every candidate's own `sourceCapturedAt` for §4.4's conflict-strength comparison. */
  documentDate: string | null;
  llmClient: LlmClient;
  /** §7.1's read set, already built by the caller (a real DB read in `capture-run`, PR12; `model.json` folded into one in the fixture harness). */
  matchIndex: MatchIndex;
  mainHead: Head;
  /** K-8/§7.1's fifth bullet, issue #285: present iff the job has a `target_branch_id` — that branch's own folded head, so a candidate matching something the target branch already proposes (but main doesn't have yet) gets `duplicate_in_target` instead of a second `new`. */
  targetHead?: Head;
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
const ACTOR_SHEET_NAME_PATTERN = /\b(actors?|teams?|owners?|contacts?)\b/i;

/**
 * §5.2: "system by default; container when the sheet is named like
 * Modules/…; capability when named like Capabilities/…; actor when named
 * like Teams/…. The model's own `sheetType` is used only when the code
 * heuristics are undecided."
 *
 * **Amended, Sprint F2b:** a mapped `parent` column no longer forces
 * `container` at the sheet level — it used to (pre-F2b), which made the
 * per-row mixed system/module split `rowsToCandidates.ts` added in this
 * same sprint unreachable dead code: every sheet with a mapped `parent`
 * column arrived there already forced to `sheetType: 'container'`, so its
 * own `sheetType === 'system' && raw !== ''` branch could never run. A
 * sheet not named like Modules/… now defaults through to `system` even
 * with a mapped `parent` column, and `rowsToCandidates.ts` decides each
 * row's own type from that column instead — blank parent → system, filled
 * → container. A sheet whose *every* row fills `parent` still resolves
 * every row to `container`, the same outcome as before; only a genuinely
 * mixed sheet (some rows blank, some filled) behaves differently now, and
 * only in the way this sprint's design intended. An unambiguously
 * container-named sheet (`CONTAINER_SHEET_NAME_PATTERN`) is unaffected
 * either way — every one of its own rows is still always `container`,
 * `parent` optional, exactly as before.
 */
export function inferSheetType(sheetName: string, llmSheetType: ElementType | null): ElementType {
  if (CONTAINER_SHEET_NAME_PATTERN.test(sheetName)) return 'container';
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

const PLAIN_ATTRIBUTE_ROLES: ReadonlySet<string> = new Set(['description', 'vendor', 'technology', 'externalOrganisation', 'hostingProvider', 'lifecycleStatus', 'introduced', 'plannedEnd', 'isExternal', 'hostingModel', 'disposition']);

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
    // A module is named by itself ("PM") or qualified by its platform ("SAP ·
    // PM" — how this product's own export writes a name two modules share).
    // Two different elements answering to one name is ambiguous: refused
    // (the row stays `invalid`) rather than linked to whichever came first.
    const hits = new Set<UUID>();
    for (const candidate of runIndex.byType.get(type) ?? []) {
      if (candidate.proposal.kind !== 'element') continue;
      const parentText = candidate.proposal.parent?.kind === 'unresolved' ? candidate.proposal.parent.text : null;
      const named = normaliseName(candidate.proposal.name) === normalised || (parentText !== null && normaliseName(`${parentText} ${candidate.proposal.name}`) === normalised);
      if (!named) continue;
      if (kindFilter && !kindFilter(type, candidate.proposal.attributes)) continue;
      const resolved = resolvedSubjectBySeq.get(candidate.seq);
      if (resolved !== undefined && resolved !== null) hits.add(resolved);
    }
    if (hits.size > 1) return null;
    const [only] = hits;
    if (only !== undefined) return only;
  }
  for (const type of expectedTypes) {
    let pool = matchIndex.elementsByType.get(type) ?? [];
    if (kindFilter) pool = pool.filter((el) => kindFilter(type, el.attributes as Record<string, unknown>));
    const qualified = pool.filter((el) => {
      const parent = el.parent_id !== null ? matchIndex.elements.get(el.parent_id) : undefined;
      return parent !== undefined && normaliseName(`${parent.name} ${el.name}`) === normalised;
    });
    if (qualified.length === 1 && qualified[0] !== undefined) return qualified[0].element_id;
    const hit = resolveByTrigram(text, pool);
    if (hit.level !== 'none' && hit.ambiguous === undefined && hit.elementId !== undefined) return hit.elementId;
  }
  return null;
}

const INTEGRATION_PLATFORM_FILTER = (elementType: ElementType, attributes: Record<string, unknown>): boolean => elementType === 'system' && attributes.kind === 'integration_platform';

/**
 * ADR-026: a `via` may name an interface — a container whose parent is an
 * integration platform — by itself ("Reads API") or qualified by its
 * platform ("MuleSoft · Reads API", how the export writes one). Exact names
 * only, never trigram: a fuzzy hit on some other platform's module would
 * silently reroute the flow. Tried before the platform itself, so the
 * qualified form is never fuzzy-matched to its bare platform. Two
 * interfaces answering to one name is ambiguous, and refused.
 */
function resolveInterfaceRef(text: string, runIndex: RunElementIndex, resolvedSubjectBySeq: ReadonlyMap<number, UUID | null>, matchIndex: MatchIndex): UUID | null {
  const normalised = normaliseName(text);
  const named = (parentName: string, name: string): boolean => normaliseName(name) === normalised || normaliseName(`${parentName} ${name}`) === normalised;
  const hits = new Set<UUID>();
  for (const candidate of runIndex.byType.get('container') ?? []) {
    if (candidate.proposal.kind !== 'element' || candidate.proposal.parent?.kind !== 'unresolved') continue;
    const parentText = candidate.proposal.parent.text;
    if (!named(parentText, candidate.proposal.name)) continue;
    if (resolveTextRef(parentText, ['system'], runIndex, resolvedSubjectBySeq, matchIndex, INTEGRATION_PLATFORM_FILTER) === null) continue;
    const resolved = resolvedSubjectBySeq.get(candidate.seq);
    if (resolved !== undefined && resolved !== null) hits.add(resolved);
  }
  for (const element of matchIndex.elementsByType.get('container') ?? []) {
    const parent = element.parent_id !== null ? matchIndex.elements.get(element.parent_id) : undefined;
    if (!parent || !INTEGRATION_PLATFORM_FILTER(parent.element_type, parent.attributes as Record<string, unknown>)) continue;
    if (named(parent.name, element.name)) hits.add(element.element_id);
  }
  if (hits.size !== 1) return null;
  const [only] = hits;
  return only ?? null;
}

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
  // F6 (ADR-023): capture never proposes a value stream or stage — the
  // layer is edited on main or in a correction only, and PROMPT_B_ELEMENT_TYPES
  // (prompts/b.ts) deliberately still lists four types. Present because
  // this Record is exhaustive over ElementType, inert in practice.
  value_stream: [],
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
  /** `proposal.elementType`, unless `match` came from `match.ts`'s own system/container cross-type fallback or platform-prefix fallback — then the matched element's *real* stored type, so the delta this candidate eventually builds carries the type the model actually has, not the model's own guess (`resolveElementType`'s own doc comment). */
  resolvedElementType: ElementType;
}

/** `match`'s own `MATCHED_CROSS_TYPE`/`MATCHED_PLATFORM_PREFIX` warnings (`match.ts`) mean `match.elementId` is a real element whose stored type differs from `proposalElementType` — everything downstream (the row key, the eventual delta's own `elementType` field) needs the matched element's real type from here on, not the candidate's original guess, or an `element.update` delta would carry a type that disagrees with the element it's updating. */
function resolveElementType(match: MatchOutcome, proposalElementType: ElementType, matchIndex: MatchIndex): ElementType {
  const fromRealType = match.warnings.includes('MATCHED_CROSS_TYPE') || match.warnings.includes('MATCHED_PLATFORM_PREFIX');
  if (!fromRealType || match.elementId === undefined) return proposalElementType;
  return matchIndex.elements.get(match.elementId)?.element_type ?? proposalElementType;
}

/** Resolves one element candidate's own `parent` ref (system/actor never have one — `context` is unconditionally top-level for them per `match.ts`'s own `contextMatches`) and matches/classifies it against main. */
function resolveElementCandidate(candidate: RowCandidate, proposal: ElementProposal, runIndex: RunElementIndex, resolvedSubjectBySeq: ReadonlyMap<number, UUID | null>, matchIndex: MatchIndex, targetOnlyIndex: MatchIndex | null, mainHead: Head, sourceCapturedAt: string | null, mintId: () => UUID): ElementResolutionResult {
  if (candidate.ungrounded) {
    return {
      class: 'unsourced',
      match: { level: 'none', score: 0, similar: [], warnings: [] },
      draftSubjectId: null,
      attributes: proposal.attributes,
      parentNameForRowKey: proposal.parent?.kind === 'unresolved' ? proposal.parent.text : null,
      resolvedParentElementId: null,
      resolvedElementType: proposal.elementType,
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
        resolvedElementType: proposal.elementType,
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
    // Sprint F2b (SPEC-capture.md §5.6): a JSON `changes`-section entry
    // names an *existing* element only — no match means the entry names
    // something nowhere in the model, `invalid`, never a `new` create and
    // never checked against the target branch either (a `changes` entry
    // is always relative to main).
    if (candidate.mustMatchExisting) {
      return { class: 'invalid', match, draftSubjectId: null, attributes, extraWarning: { code: 'PARENT_UNRESOLVED', text: proposal.name }, parentNameForRowKey, resolvedParentElementId, resolvedElementType: proposal.elementType };
    }
    if (targetOnlyIndex) {
      const targetMatch = matchElement(
        { name: proposal.name, elementType: proposal.elementType, context: proposal.parent === null ? TOP_LEVEL_CONTEXT : contextElementId },
        targetOnlyIndex,
      );
      if (targetMatch.level !== 'none') {
        return {
          class: 'duplicate_in_target',
          match: targetMatch,
          draftSubjectId: null,
          attributes,
          parentNameForRowKey,
          resolvedParentElementId,
          resolvedElementType: resolveElementType(targetMatch, proposal.elementType, targetOnlyIndex),
        };
      }
    }
    return { class: 'new', match, draftSubjectId: mintId(), attributes, parentNameForRowKey, resolvedParentElementId, resolvedElementType: proposal.elementType };
  }

  const matchedElementId = match.elementId;
  if (matchedElementId === undefined) throw new RunCaptureError(`seq ${String(candidate.seq)}: internal — a match outcome above 'none' always carries an elementId.`);

  const comparisons = attributeComparisons(proposal.attributes, candidate.evidence.attributeConfidence, matchedElementId, mainHead, sourceCapturedAt);
  const cls = classifyElement({ match, attributes: [...comparisons.values()] });
  const outcomes = new Map<string, AttributeOutcome>([...comparisons].map(([key, input]) => [key, classifyAttribute(input)]));
  const attributes = filterAttributesForClass(proposal.attributes, cls, outcomes);

  // `match.ts`'s own `resolvePlatformPrefixed`: the document never named a
  // parent for this candidate at all (it wrote the platform name inline,
  // e.g. "SAP PM"), so the parent recovered here is the *only* source of
  // one — nothing above already set `resolvedParentElementId` in this
  // branch (it's only ever set from `proposal.parent`, which is `null`
  // whenever this fallback is what found the match).
  if (match.warnings.includes('MATCHED_PLATFORM_PREFIX') && match.resolvedParentId !== undefined) {
    resolvedParentElementId = match.resolvedParentId;
  }

  return { class: cls, match, draftSubjectId: matchedElementId, attributes, parentNameForRowKey, resolvedParentElementId, resolvedElementType: resolveElementType(match, proposal.elementType, matchIndex) };
}

// ---------------------------------------------------------------------------
// Relationship resolution.
// ---------------------------------------------------------------------------

/**
 * §6.2's own prompt-B endpoint types, per relationship type **and per end**
 * (a `supports` is system|container → capability, an `owns` is actor →
 * capability|system|container, and so on). `resolveEndpointRef` looks each
 * `unresolved` text up in *its own end's* bucket, so a capability named as a
 * `supports.from` (the document describing one capability supporting another,
 * which the taxonomy doesn't model) resolves to nothing and marks the
 * candidate `invalid` — instead of the old single shared list resolving both
 * ends against `capability` and emitting a `supports(capability, capability)`
 * the engine then rejects at fold time (C9). Sheet rows never reach this
 * record (`rowsToCandidates.ts`/`capabilityAssignment.ts` already resolve
 * their endpoints to a candidate seq or a main id), so only prose extraction
 * is affected.
 */
const ENDPOINT_TYPES_BY_RELATIONSHIP: Readonly<Record<RelationshipType, { from: readonly ElementType[]; to: readonly ElementType[] }>> = {
  supports: { from: ['system', 'container'], to: ['capability'] },
  uses: { from: ['system', 'container', 'actor'], to: ['system', 'container'] },
  owns: { from: ['actor'], to: ['capability', 'system', 'container'] },
  flows_to: { from: ['system', 'container'], to: ['system', 'container'] },
  // ADR-001 amendment ("replaces") — legal endpoint types match
  // RELATIONSHIP_TYPE_RULES' own system/container-to-system/container triples.
  replaces: { from: ['system', 'container'], to: ['system', 'container'] },
  // F6 (ADR-023): never proposed by capture (see REQUIRED_ATTRIBUTES_BY_TYPE's
  // own value_stream note) — listed because this Record is exhaustive.
  enables: { from: ['capability'], to: ['value_stream'] },
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
  const resolvedId = resolveTextRef(ref.text, ENDPOINT_TYPES_BY_RELATIONSHIP[relationshipType][end], runIndex, resolvedSubjectBySeq, matchIndex);
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
    const viaId = resolveInterfaceRef(viaHint, runIndex, resolvedSubjectBySeq, matchIndex) ?? resolveTextRef(viaHint, ['system'], runIndex, resolvedSubjectBySeq, matchIndex, INTEGRATION_PLATFORM_FILTER);
    if (viaId !== null) attributes = { ...attributes, via: viaId };
    // §7.4/§5.2: an unresolved `via` (no such system, or not an integration platform or an interface on one) is dropped, never invalidating (`via` is optional) — but no longer silently: the same `ENDPOINT_UNRESOLVED` warning a missing endpoint gets, with `end: 'via'` (the code's own type already named it), so the review shows the flow was imported as direct.
    else extraWarnings.push({ code: 'ENDPOINT_UNRESOLVED', text: viaHint, end: 'via' });
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

/**
 * §5.5: `candidateConf = existenceConf` — computed the same way for every
 * class, elements only ("min over {name, required attributes present}"); a
 * matched candidate's own per-attribute *delta* confidence (`updateConf`,
 * capped by match confidence) is a separate, lower-level number
 * `buildCaptureDraftEnvelope.ts` computes itself, not this one.
 *
 * **Amended, Sprint F2b:** `mustMatchExisting` (a JSON `changes`-section
 * entry) never asserts `name` or most of `REQUIRED_ATTRIBUTES_BY_TYPE` —
 * a retire/restore only ever touches `lifecycleStatus`, deliberately never
 * re-describing the element it targets (unlike a `new`/ordinary `update`
 * candidate, which always does, via `applyRequiredDefaults`). Flooring on
 * a `name`/`isExternal`/… confidence such a candidate never has any reason
 * to set made every retire/restore's own top-level `confidence` read 0
 * regardless of how confident its actual `lifecycleStatus` claim was —
 * caught building fixture 12 (bug, not a real "no confidence at all"
 * candidate: `buildCaptureDraftEnvelope.ts` reads `attributeConfidence`
 * per attribute directly, so the promoted delta's own confidence was
 * never wrong, only the candidate's own displayed/sorted score). Falls
 * back to whatever attributes it actually populated, the same "no fixed
 * required list" shape `relationshipCandidateConfidence` already uses.
 */
function elementCandidateConfidence(elementType: ElementType, attributeConfidence: Readonly<Record<string, number>>, mustMatchExisting: boolean): number {
  if (mustMatchExisting) return existenceConf(Object.values(attributeConfidence));
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
  if (source.format === 'json') {
    return runJsonCapture({ ...input, source });
  }
  return runSheetCapture({ ...input, source });
}

// ---------------------------------------------------------------------------
// Spreadsheet/CSV path (§5.2, §12's own fixtures 01-07).
// ---------------------------------------------------------------------------

async function runSheetCapture(input: RunSheetCaptureInput): Promise<RunCaptureResult> {
  const { inputName, source, documentDate, llmClient, matchIndex, mainHead, targetHead, reimportPrevious, mintId } = input;
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

    // Sprint F2b (SPEC-capture.md §5.2a): a Relationships sheet is detected
    // and parsed before any column mapping — its rows are relationships
    // directly, never element rows, and need no LLM call at all.
    if (isRelationshipsSheet(sheet.sheetName, sheet.headers)) {
      const { candidates: relationshipCandidates, skipped: skippedRelationshipRows } = relationshipSheetToCandidates({ sheetName: sheet.sheetName, headers: sheet.headers, headerColumnRefs: sheet.headerColumnRefs, rawSheet, headerRowIndex });
      for (const skip of skippedRelationshipRows) bumpStat(`relationships.skipped.${skip.reason}`);
      bumpStat('sheet.type.relationships');
      usableSheetCount++;
      combined = combined.concat(relationshipCandidates.map((c) => offsetRowCandidate(c, seqOffset)));
      seqOffset += relationshipCandidates.length;
      continue;
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

    const llmSheetType = mapped.llmSheetType !== null && mapped.llmSheetType !== 'unknown' ? mapped.llmSheetType : null;
    const sheetType = inferSheetType(sheet.sheetName, llmSheetType);
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

  // One actor per name across the workbook: an owner cell and an Actors sheet
  // both name the same actor, and this product's own export writes both.
  combined = mergeSameNamedActors(combined).candidates;

  if (capabilityRows.length > 0) {
    const { candidates: supportsCandidates } = await assignCapabilities({ rows: capabilityRows, matchIndex, llmClient, startSeq: seqOffset, mainHead });
    combined = combined.concat(supportsCandidates);
  }

  return classifyAndResolve(combined, matchIndex, targetHead, mainHead, documentDate, reimportPrevious, mintId, stats);
}

// ---------------------------------------------------------------------------
// JSON path (§5.6, Sprint F2b) — pre-parsed systems/relationships/changes,
// folded in from F2-lite's own JSON import. No column mapping and no LLM
// call for the systems/relationships sections (the file already names its
// fields); capability lists still go through `assignCapabilities` (§6.3),
// reusing the exact same pipe-list/single-value split Sprint F2b's own
// sheet path already has.
// ---------------------------------------------------------------------------

interface RunJsonCaptureInput extends Omit<RunCaptureInput, 'source'> {
  source: { format: 'json'; text: string };
}

/** §5.6: 1.0 is reserved for a real human assertion made in the review queue's own edit panel — an uploaded file (often AI-drafted, `docs/import/PROMPT.md`) isn't that, even though a human chose to upload it. A stated `confidence` is used as given, clipped to [0, 1]. */
const JSON_CONFIDENCE_CAP = 0.9;

function jsonConfidence(stated: number | undefined): number {
  return stated === undefined ? JSON_CONFIDENCE_CAP : Math.max(0, Math.min(1, stated));
}

/** §5.6: no raw document exists for a JSON entry to ground a passage against — `start`/`end` are a stable per-entry locator, not a byte offset into anything; the review queue's source pane shows the whole passage regardless of these. */
function jsonSourceRef(index: number): SourceRef {
  return { kind: 'text', start: index, end: index };
}

/** §5.6: `evidence.passage` is the entry's own `quote` verbatim when given, else its JSON fragment rendered as text. */
function jsonPassage(quote: string | undefined, fallback: unknown): string {
  return quote ?? JSON.stringify(fallback);
}

function actorSubtypeFor(owner: OwnerReference): ActorSubtype {
  if (owner.externalOrganisation !== null) return 'organisation';
  return looksLikePersonName(owner.name) ? 'person' : 'team';
}

interface JsonActorGroup {
  seq: number;
  ref: OwnerReference;
}

interface JsonPendingOwns {
  ownerKey: string;
  elementSeq: number;
  role: OwnsRole;
  confidence: number;
  index: number;
}

function actorKeyFor(owner: OwnerReference): string {
  return `${owner.externalOrganisation ?? ''}|${normaliseName(owner.name)}`;
}

/** §5.6's own `systems` section: one element candidate per row, plus its owners (actor + `owns`) and its capability list (deferred to `assignCapabilities`, same as a sheet's own `capability` column). */
function buildJsonElementCandidates(rows: readonly ImportRow[], startSeq: number): { candidates: RowCandidate[]; capabilityRows: CapabilityColumnRow[]; nextSeq: number } {
  const candidates: RowCandidate[] = [];
  const capabilityRows: CapabilityColumnRow[] = [];
  const actorGroups = new Map<string, JsonActorGroup>();
  const pendingOwns: JsonPendingOwns[] = [];
  let seq = startSeq;

  rows.forEach((row, index) => {
    const elSeq = seq++;
    const confidence = jsonConfidence(row.confidence);
    const attributes: Record<string, unknown> = { ...row.attributes };
    if (row.isExternal !== undefined) attributes.isExternal = row.isExternal;
    const attributeConfidence: Record<string, number> = { name: confidence };
    for (const key of Object.keys(attributes)) attributeConfidence[key] = confidence;
    applyRequiredDefaults(row.elementType, attributes, attributeConfidence, {}, jsonSourceRef(index));

    const proposal: ElementProposal = { kind: 'element', elementType: row.elementType, name: row.name, parent: row.platformName !== null ? { kind: 'unresolved', text: row.platformName } : null, attributes };
    const evidence: CandidateEvidence = { sourceRef: jsonSourceRef(index), passage: jsonPassage(row.quote, { name: row.name, ...row.attributes }), extractor: 'json-authored', attributeConfidence, warnings: [] };
    candidates.push({ seq: elSeq, proposal, evidence, aliasProposals: [{ type: 'name', value: row.name }] });

    const [soleCapabilityName] = row.capabilityNames;
    if (soleCapabilityName !== undefined) {
      const capabilityText = row.capabilityNames.length === 1 ? soleCapabilityName : row.capabilityNames.join('|');
      const description = attributes.description;
      capabilityRows.push({ seq: elSeq, systemName: row.name, ...(typeof description === 'string' ? { description } : {}), capabilityText, sourceRef: jsonSourceRef(index) });
    }

    for (const [owner, role] of [
      [row.businessOwner, 'business' as const],
      [row.technicalOwner, 'technical' as const],
    ] satisfies [OwnerReference | null, OwnsRole][]) {
      if (!owner) continue;
      const key = actorKeyFor(owner);
      if (!actorGroups.has(key)) actorGroups.set(key, { seq: seq++, ref: owner });
      pendingOwns.push({ ownerKey: key, elementSeq: elSeq, role, confidence, index });
    }
  });

  for (const group of actorGroups.values()) {
    const isExternal = group.ref.externalOrganisation !== null;
    const attributes: Record<string, unknown> = { subtype: actorSubtypeFor(group.ref), isExternal };
    const attributeConfidence: Record<string, number> = { subtype: DEFAULTED_ATTRIBUTE_CONFIDENCE, isExternal: isExternal ? JSON_CONFIDENCE_CAP : DEFAULTED_ATTRIBUTE_CONFIDENCE, name: JSON_CONFIDENCE_CAP };
    if (group.ref.externalOrganisation !== null) {
      attributes.externalOrganisation = group.ref.externalOrganisation;
      attributeConfidence.externalOrganisation = JSON_CONFIDENCE_CAP;
    }
    const proposal: ElementProposal = { kind: 'element', elementType: 'actor', name: group.ref.name, parent: null, attributes };
    const evidence: CandidateEvidence = { sourceRef: jsonSourceRef(group.seq), passage: group.ref.name, extractor: 'json-authored', attributeConfidence, warnings: [] };
    candidates.push({ seq: group.seq, proposal, evidence, aliasProposals: [{ type: 'name', value: group.ref.name }] });
  }

  for (const pending of pendingOwns) {
    const actorSeq = actorGroups.get(pending.ownerKey)?.seq;
    if (actorSeq === undefined) continue;
    const proposal: RelationshipProposal<'owns'> = { kind: 'relationship', relationshipType: 'owns', from: { kind: 'candidate', seq: actorSeq }, to: { kind: 'candidate', seq: pending.elementSeq }, attributes: { role: pending.role } };
    const evidence: CandidateEvidence = { sourceRef: jsonSourceRef(pending.index), passage: '', extractor: 'json-authored', attributeConfidence: { role: pending.confidence }, warnings: [] };
    candidates.push({ seq: seq++, proposal, evidence, aliasProposals: [] });
  }

  return { candidates, capabilityRows, nextSeq: seq };
}

/** §5.6's own `relationships` section — the JSON sibling of §5.2a's Relationships sheet, same shape (unresolved `from`/`to`, `viaHint`), no LLM call. */
function buildJsonRelationshipCandidates(rows: readonly ImportRelationshipRow[], startSeq: number): { candidates: RowCandidate[]; nextSeq: number } {
  const candidates: RowCandidate[] = [];
  let seq = startSeq;
  rows.forEach((row, index) => {
    const confidence = jsonConfidence(row.confidence);
    const attributes: Record<string, unknown> = { description: row.description };
    if (row.type === 'flows_to' && row.dataClassification !== null) attributes.dataClassification = row.dataClassification;
    if (row.protocolIn !== null) attributes.protocolIn = row.protocolIn;
    if (row.protocolOut !== null) attributes.protocolOut = row.protocolOut;
    const attributeConfidence: Record<string, number> = Object.fromEntries(Object.keys(attributes).map((key) => [key, confidence]));

    const proposal: RelationshipProposal<'uses' | 'flows_to'> = { kind: 'relationship', relationshipType: row.type, from: { kind: 'unresolved', text: row.from }, to: { kind: 'unresolved', text: row.to }, attributes };
    const evidence: CandidateEvidence = { sourceRef: jsonSourceRef(index), passage: jsonPassage(row.quote, row), extractor: 'json-authored', attributeConfidence, warnings: [] };
    candidates.push({ seq: seq++, proposal, evidence, ...(row.via !== null ? { viaHint: row.via } : {}), aliasProposals: [] });
  });
  return { candidates, nextSeq: seq };
}

/** §5.6's own `changes` section only ever targets a `system` or a `container` (never a capability/actor) — neither the entry nor the contract states which, so this picks whichever type an exact-normalised-name match resolves against on main, defaulting to `system` when neither does (`resolveElementCandidate`'s own full alias/trigram match, called downstream, still does the real work — this only decides which pool it searches). */
function inferChangeTargetType(name: string, matchIndex: MatchIndex): ElementType {
  const normalised = normaliseName(name);
  const aliasHit = matchIndex.aliasByNormalisedValue.get(normalised);
  const aliasElement = aliasHit ? matchIndex.elements.get(aliasHit.elementId) : undefined;
  if (aliasElement?.element_type === 'system' || aliasElement?.element_type === 'container') return aliasElement.element_type;
  for (const type of ['system', 'container'] as const) {
    if ((matchIndex.elementsByType.get(type) ?? []).some((el) => normaliseName(el.name) === normalised)) return type;
  }
  return 'system';
}

/**
 * §5.6's own `changes` section: an explicit retire/restore instruction
 * against an *existing* element only — `mustMatchExisting` makes
 * `resolveElementCandidate` refuse to fall through to `new`.
 *
 * `replaced_by` (retire only) is proposed as its own ordinary `replaces`
 * relationship candidate — `{kind:'unresolved', text: replacedBy}` to
 * `{kind:'unresolved', text: row.name}` — rather than a new field on this
 * candidate: `resolveEndpointRef` already refuses to resolve either end to
 * anything but an existing element (never mints one), which is exactly
 * "replaced_by never creates anything" for free, and `buildPromotionEnvelope.ts`
 * (Step 4) triggers the retiring element's own supports-edge transfer off
 * this same candidate being promoted `new` — no `CaptureCandidate` schema
 * change needed for either half of the mechanism.
 */
function buildJsonChangeCandidates(rows: readonly ImportChangeRow[], startSeq: number, matchIndex: MatchIndex): { candidates: RowCandidate[]; nextSeq: number } {
  const candidates: RowCandidate[] = [];
  let seq = startSeq;
  rows.forEach((row, index) => {
    const confidence = jsonConfidence(row.confidence);
    const lifecycleStatus = row.action === 'retire' ? 'retired' : 'active';
    const elementType = inferChangeTargetType(row.name, matchIndex);
    const proposal: ElementProposal = { kind: 'element', elementType, name: row.name, parent: null, attributes: { lifecycleStatus } };
    const evidence: CandidateEvidence = { sourceRef: jsonSourceRef(index), passage: jsonPassage(row.quote, row), extractor: 'json-authored', attributeConfidence: { lifecycleStatus: confidence }, warnings: [] };
    candidates.push({ seq: seq++, proposal, evidence, aliasProposals: [], mustMatchExisting: true });

    if (row.replacedBy !== null) {
      const replacesProposal: RelationshipProposal<'replaces'> = { kind: 'relationship', relationshipType: 'replaces', from: { kind: 'unresolved', text: row.replacedBy }, to: { kind: 'unresolved', text: row.name }, attributes: {} };
      const replacesEvidence: CandidateEvidence = { sourceRef: jsonSourceRef(index), passage: jsonPassage(row.quote, row), extractor: 'json-authored', attributeConfidence: {}, warnings: [] };
      candidates.push({ seq: seq++, proposal: replacesProposal, evidence: replacesEvidence, aliasProposals: [] });
    }
  });
  return { candidates, nextSeq: seq };
}

async function runJsonCapture(input: RunJsonCaptureInput): Promise<RunCaptureResult> {
  const { inputName, source, documentDate, llmClient, matchIndex, mainHead, targetHead, reimportPrevious, mintId } = input;
  const stats: Record<string, number> = {};

  let parsed;
  try {
    parsed = parseImportJsonText(source.text, inputName);
  } catch (e) {
    if (e instanceof ImportFileParseError) return { status: 'failed', errorCode: 'INPUT_UNREADABLE', message: e.message };
    throw e;
  }

  const { candidates: elementCandidates, capabilityRows, nextSeq: afterElements } = buildJsonElementCandidates(parsed.rows, 0);
  const { candidates: relationshipCandidates, nextSeq: afterRelationships } = buildJsonRelationshipCandidates(parsed.relationshipRows, afterElements);
  const { candidates: changeCandidates, nextSeq: afterChanges } = buildJsonChangeCandidates(parsed.changeRows, afterRelationships, matchIndex);

  let combined: RowCandidate[] = [...elementCandidates, ...relationshipCandidates, ...changeCandidates];

  if (capabilityRows.length > 0) {
    const { candidates: supportsCandidates } = await assignCapabilities({ rows: capabilityRows, matchIndex, llmClient, startSeq: afterChanges, mainHead });
    combined = combined.concat(supportsCandidates);
  }

  const { candidates: deduped } = dedupeIntraDocumentCandidates(combined);
  return classifyAndResolve(deduped, matchIndex, targetHead, mainHead, documentDate, reimportPrevious, mintId, stats);
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
  const { inputName, source, llmClient, matchIndex, mainHead, targetHead, documentDate, reimportPrevious, mintId } = input;
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

  // §6.2's `priorElementNames` cross-chunk hint is dropped so the chunks run
  // concurrently: firing every prompt-B call at once bounds the whole run by
  // the *slowest* chunk rather than their sum, which is what lets a multi-page
  // PDF finish inside one edge-function invocation (a sequential pass over a
  // 5-chunk document was timing out at ~3 minutes of LLM calls). The hint was
  // never a correctness requirement — `intraDocumentDedup` below already
  // merges an element re-emitted across chunk boundaries, and a cross-chunk
  // `parentName`/endpoint resolves by name in `classifyAndResolve` against
  // this run's own candidates — so dropping it only costs a little extra
  // de-dup work, never a lost reference.
  const chunkResults = await Promise.all(
    chunkEntries.map((entry) => {
      const location = entry.kind === 'pdf' ? ({ kind: 'pages', first: entry.chunk.firstPage, last: entry.chunk.lastPage, total: entry.chunk.totalPages } as const) : ({ kind: 'pastedText', start: entry.chunk.start, end: entry.chunk.end, total: entry.chunk.total } as const);
      const sourceRefForOffset = entry.kind === 'pdf' ? (start: number, end: number): SourceRef => pdfChunkSourceRefFor(entry.chunk, start, end) : (start: number, end: number): SourceRef => textChunkSourceRefFor(entry.chunk, start, end);
      return extractProseChunk({ llmClient, inputName, location, chunkText: entry.chunk.text, priorElementNames: [], sourceRefForOffset });
    }),
  );

  let combined: RowCandidate[] = [];
  let seqOffset = 0;
  for (const { candidates } of chunkResults) {
    combined = combined.concat(candidates.map((c) => offsetRowCandidate(c, seqOffset)));
    seqOffset += candidates.length;
    bump(stats, 'chunks');
  }

  // §5.2's own "Intra-document duplicates" pass (`intraDocumentDedup.ts`) is extractor-agnostic — reused here across the whole document's own chunks, not per-chunk, since the same element can plausibly recur across chunk boundaries despite §6.2's own "do not re-emit" instruction to the model.
  const { candidates: deduped } = dedupeIntraDocumentCandidates(combined);

  return classifyAndResolve(deduped, matchIndex, targetHead, mainHead, documentDate, reimportPrevious, mintId, stats);
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

/**
 * Elements with a parent, in an order where every parent that is itself a
 * candidate in this run resolves before its children. A capability tree is
 * more than two levels deep, and a sheet sorted by name (this product's own
 * export is) lists a child before its parent — resolving in `seq` order made
 * that child `invalid` ("PARENT_UNRESOLVED") for want of an ordering. Stable:
 * candidates at the same depth keep their `seq` order; a cycle (a bad file
 * naming each other as parent) is cut where it is found and left to resolve
 * as `invalid` the way it would have before.
 */
export function orderByParentDependency<T extends RowCandidate & { proposal: ElementProposal }>(candidates: readonly T[]): T[] {
  const byName = new Map<string, T[]>();
  for (const candidate of candidates) {
    const key = normaliseName(candidate.proposal.name);
    byName.set(key, [...(byName.get(key) ?? []), candidate]);
  }
  const depthMemo = new Map<T, number>();
  const depthOf = (candidate: T, visiting: Set<T>): number => {
    const known = depthMemo.get(candidate);
    if (known !== undefined) return known;
    if (visiting.has(candidate)) return 0;
    const parent = candidate.proposal.parent;
    let depth = 0;
    if (parent !== null && parent.kind === 'unresolved') {
      visiting.add(candidate);
      for (const possibleParent of byName.get(normaliseName(parent.text)) ?? []) {
        if (possibleParent !== candidate && possibleParent.proposal.elementType === candidate.proposal.elementType) depth = Math.max(depth, 1 + depthOf(possibleParent, visiting));
      }
      visiting.delete(candidate);
    }
    depthMemo.set(candidate, depth);
    return depth;
  };
  return candidates.map((candidate, index) => ({ candidate, index, depth: depthOf(candidate, new Set()) })).sort((a, b) => a.depth - b.depth || a.index - b.index).map((entry) => entry.candidate);
}

function classifyAndResolve(combined: readonly RowCandidate[], matchIndex: MatchIndex, targetHead: Head | undefined, mainHead: Head, documentDate: string | null, reimportPrevious: readonly PreviousCandidateForDiff[] | undefined, mintId: () => UUID, stats: Record<string, number>): RunCaptureResult {
  const runIndex = buildRunElementIndex(combined);
  const relationshipIndex = buildRelationshipIndex(mainHead);
  const targetOnlyIndex = targetHead ? buildTargetOnlyMatchIndex(targetHead, mainHead) : null;

  const resolvedSubjectBySeq = new Map<number, UUID | null>();
  const seqByElementId = new Map<UUID, number>();
  const rowKeyBySeq = new Map<number, string>();
  const built = new Map<number, ResolvedCandidate>();

  const elementsNoParent = combined.filter((c): c is RowCandidate & { proposal: ElementProposal } => c.proposal.kind === 'element' && c.proposal.parent === null);
  const elementsWithParent = combined.filter((c): c is RowCandidate & { proposal: ElementProposal } => c.proposal.kind === 'element' && c.proposal.parent !== null);
  const relationships = combined.filter((c): c is RowCandidate & { proposal: RelationshipProposal } => c.proposal.kind === 'relationship');

  const resolveOneElement = (candidate: RowCandidate & { proposal: ElementProposal }): void => {
    const result = resolveElementCandidate(candidate, candidate.proposal, runIndex, resolvedSubjectBySeq, matchIndex, targetOnlyIndex, mainHead, documentDate, mintId);
    resolvedSubjectBySeq.set(candidate.seq, result.draftSubjectId);
    if (result.draftSubjectId !== null) seqByElementId.set(result.draftSubjectId, candidate.seq);

    // `result.resolvedElementType`, not `candidate.proposal.elementType` —
    // the candidate's own type once `match.ts`'s cross-type fallback found
    // it (e.g. an LLM-guessed `system` that's actually a `container`), so
    // the row key, confidence, and the final proposal/candidate all agree
    // with the real element rather than repeating the model's own guess.
    const rowKey = elementRowKey({
      elementType: result.resolvedElementType,
      name: candidate.proposal.name,
      parentName: result.parentNameForRowKey,
      ...(candidate.matchHints?.atlasId !== undefined ? { atlasId: candidate.matchHints.atlasId } : {}),
      ...(candidate.matchHints?.sourceKeys !== undefined ? { sourceKeys: candidate.matchHints.sourceKeys } : {}),
    });
    rowKeyBySeq.set(candidate.seq, rowKey);

    const warnings = result.extraWarning ? [...candidate.evidence.warnings, result.extraWarning] : candidate.evidence.warnings;
    const parent: ElementProposal['parent'] = result.resolvedParentElementId !== null ? { kind: 'existing', elementId: result.resolvedParentElementId } : null;
    const proposal: ElementProposal = { ...candidate.proposal, elementType: result.resolvedElementType, parent, attributes: result.attributes };
    const confidence = elementCandidateConfidence(result.resolvedElementType, candidate.evidence.attributeConfidence, candidate.mustMatchExisting ?? false);

    built.set(candidate.seq, {
      seq: candidate.seq,
      kind: 'element',
      class: result.class,
      elementType: result.resolvedElementType,
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
  for (const candidate of orderByParentDependency(elementsWithParent)) resolveOneElement(candidate);

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


