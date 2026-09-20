/**
 * F2 (full K1), SPEC-capture.md §5.2 step 3 + its own "Intra-document
 * duplicates" paragraph: turns a sheet's own resolved column roles and data
 * rows into `CandidateProposal`s + evidence. Pure — no I/O, no LLM call
 * (that's `mapColumns.ts`, already run by the time this module sees a
 * sheet). Matching (§7) and classification (§4.4) are downstream of this
 * module's output, not its job (`match.ts`'s own module comment makes the
 * same "context/matching is the caller's job" split).
 *
 * Scope, disclosed:
 * - `capability` columns are deferred to §6.3 (prompt C, PR6) — this module
 *   records each element's own raw capability-column text for that later
 *   batch, never resolves it here.
 * - `usesSystems`/`flowsTo` endpoints and `parent` are always
 *   `{kind:'unresolved', text}`; resolving them against this run's own
 *   other candidates or against main is §7.4's job (the orchestrator,
 *   PR10) — the one exception is an `owns` relationship's own two
 *   endpoints, minted and resolved right here, because both sides (the
 *   row's actor and the row's own element) are created in this same pass.
 * - `integrationPlatform` (`via`) is carried as `RowCandidate.viaHint`, not
 *   inside `attributes.via` — `UsesAttributes.via`/`FlowsToAttributes.via`
 *   are typed `UUID` (a *resolved* reference), so a raw, not-yet-resolved
 *   name can't live there; the orchestrator resolves it into a real
 *   `via: UUID` the same pass it resolves `to` (§7.4).
 * - Intra-document duplicate grouping here is **exact**, on
 *   `normaliseName(type, name, parent)` — it catches the same entity spelled
 *   with different case or whitespace runs (`PowerON`/`POWERON`), but not a
 *   name with extra text (`PowerOn (Enzen)`) or a genuinely different
 *   spacing pattern (`Power On`) that only trigram similarity would catch.
 *   Fixture 04's own full "4 rows → 1 candidate" outcome needs that fuzzier
 *   pass too; §7.3's own trigram matcher (`match.ts`) already exists for
 *   comparing a candidate against main, and running it *within* one run's
 *   own candidates as an extra pass is the orchestrator's job (PR10), not
 *   duplicated here.
 */
import type { CandidateEvidence, CandidateProposal, CaptureAliasType, ElementProposal, EvidenceWarning, RelationshipProposal } from '../contracts/capture';
import type { ActorSubtype, ElementType, OwnsRole, UUID } from '../contracts/delta';
import type { SourceRef } from '../contracts/sourceRef';
import { DEFAULTED_ATTRIBUTE_CONFIDENCE, parseFactorFor, rowFactorFor, sheetAttrConf } from './confidence';
import type { ColumnRoleAssignment } from './columnSynonyms';
import { normaliseName } from './normalise';
import { looksLikePersonName, parseBool, parseDate, parseEmail, parseHostingModel, parseLifecycle, parseName } from './normaliseValue';
import { extractDataRows, type CellMeta, type RawSheet } from './parse/sheetGrid';
import type { PromptAColumnRole } from './prompts/a';

export interface RowCandidate {
  seq: number;
  proposal: CandidateProposal;
  evidence: CandidateEvidence;
  /** §7.3 matching hints — element candidates only. */
  matchHints?: { atlasId?: UUID; sourceKeys?: string[] };
  /** §7.4: an unresolved `integrationPlatform` name for a `uses`/`flows_to` candidate — resolved into `attributes.via` (a real element id) by the orchestrator, alongside this candidate's own `to`. Absent for every other candidate. */
  viaHint?: string;
  /** §7.6 — proposed, never written here (PR8's own job). */
  aliasProposals: { type: CaptureAliasType; value: string }[];
  /** §5.3 (PR11): the candidate's own defining passage (an element's `name`, or a relationship's own `passage`) failed to ground — the orchestrator classifies it `unsourced` before any matching is attempted, the same early-return shape `PARENT_UNRESOLVED` already gets. Never set by `rowsToCandidates.ts` itself (a sheet cell is never ungrounded). */
  ungrounded?: boolean;
}

export interface RowsToCandidatesInput {
  sheetName: string;
  sheetType: ElementType;
  /** Aligned by column index; `''` for a blank header cell. */
  headers: readonly string[];
  /** A1 column letters, aligned to `headers`. */
  headerColumnRefs: readonly string[];
  /** `resolveColumnRoles`'s own output — aligned to `headers`. */
  roles: readonly (ColumnRoleAssignment | null)[];
  nameColumnIndex: number;
  rawSheet: RawSheet;
  headerRowIndex: number;
}

/** One system's own raw `capability`-column text — §6.3's own batch input (`capabilityAssignment.ts`, PR6). */
export interface CapabilityColumnRow {
  seq: number;
  systemName: string;
  description?: string;
  capabilityText: string;
  sourceRef: SourceRef;
}

export interface RowsToCandidatesResult {
  candidates: RowCandidate[];
  /** Only the element candidates from a sheet with a mapped `capability` column. */
  capabilityRows: CapabilityColumnRow[];
}

type Role = PromptAColumnRole;

const PLAIN_ATTRIBUTES: ReadonlySet<Role> = new Set(['description', 'vendor', 'technology', 'externalOrganisation', 'hostingProvider']);
const MULTI_VALUE_SEPARATOR = / \/ /;
const LIST_SPLIT_PATTERN = /[;,/\n]/;

function cellRef(sheetName: string, headerColumnRefs: readonly string[], colIndex: number, rowNumber: number): SourceRef {
  return { kind: 'sheet', sheet: sheetName, range: `${headerColumnRefs[colIndex] ?? '?'}${String(rowNumber)}` };
}

function rowRangeRef(sheetName: string, headerColumnRefs: readonly string[], rowNumber: number): SourceRef {
  const first = headerColumnRefs[0] ?? '?';
  const last = headerColumnRefs[headerColumnRefs.length - 1] ?? first;
  return { kind: 'sheet', sheet: sheetName, range: `${first}${String(rowNumber)}:${last}${String(rowNumber)}` };
}

function rowPassage(headers: readonly string[], cells: readonly string[]): string {
  return [...headers, ...cells].join(' | ');
}

function cellWarnings(meta: CellMeta | undefined, cellRefText: string): EvidenceWarning[] {
  const warnings: EvidenceWarning[] = [];
  if (meta?.merged) warnings.push({ code: 'MERGED_CELL', cell: cellRefText });
  if (meta?.formulaError) warnings.push({ code: 'FORMULA_ERROR', cell: cellRefText });
  return warnings;
}

/** §5.2: "keeps the first value as the attribute, warns, and shows the whole cell in the passage." */
function collapseMultiValue(raw: string): { value: string; multiValue: boolean } {
  const parts = raw.split(MULTI_VALUE_SEPARATOR);
  return parts.length > 1 && parts[0] !== undefined ? { value: parts[0].trim(), multiValue: true } : { value: raw.trim(), multiValue: false };
}

function deepEqualJsonLoose(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface AttributeState {
  value: unknown;
  confidence: number;
  ref: SourceRef;
}

interface ElementGroup {
  seq: number;
  elementType: ElementType;
  /** The first row's own raw name text — §5.2: the survivor keeps the first row's value. */
  name: string;
  nameConfidence: number;
  nameRef: SourceRef;
  firstRowNumber: number;
  parentText: string | null;
  attributes: Map<string, AttributeState>;
  warnings: EvidenceWarning[];
  passages: string[];
  aliasProposals: { type: CaptureAliasType; value: string }[];
  atlasId?: UUID;
  sourceKeys: string[];
  capabilityColumnText?: string;
  capabilityColumnRef?: SourceRef;
}

interface ActorGroup {
  seq: number;
  name: string;
  nameConfidence: number;
  nameRef: SourceRef;
  subtype: ActorSubtype;
  email?: string;
  emailConfidence?: number;
  emailRef?: SourceRef;
  warnings: EvidenceWarning[];
  passages: string[];
  aliasProposals: { type: CaptureAliasType; value: string }[];
}

interface PendingOwns {
  ownerGroupKey: string;
  elementGroupKey: string;
  role: OwnsRole;
  roleConfidence: number;
  ref: SourceRef;
  passage: string;
}

interface PendingRelationship {
  relationshipType: 'uses' | 'flows_to';
  fromElementGroupKey: string;
  toText: string;
  viaText: string | undefined;
  ref: SourceRef;
  passage: string;
}

function elementGroupKey(elementType: ElementType, name: string, parentText: string | null): string {
  return `${elementType}|${normaliseName(name)}|${parentText ? normaliseName(parentText) : ''}`;
}

function actorGroupKey(name: string): string {
  return `actor|${normaliseName(name)}`;
}

/** §5.4's two defaults, applied only when the document didn't state the value at all — shared by every extractor (sheet rows here; prose in `extractProse.ts`, PR11), since §5.4 sits after both §5.2 and §5.3 in the spec and states no per-extractor scope. */
export function applyRequiredDefaults(elementType: ElementType, attributes: Record<string, unknown>, attributeConfidence: Record<string, number>, attributeRefs: Record<string, SourceRef>, rowRange: SourceRef): void {
  if (elementType === 'system' && attributes.lifecycleStatus === undefined) {
    attributes.lifecycleStatus = 'active';
    attributeConfidence.lifecycleStatus = DEFAULTED_ATTRIBUTE_CONFIDENCE;
    attributeRefs.lifecycleStatus = rowRange;
  }
  if ((elementType === 'system' || elementType === 'container') && attributes.isExternal === undefined) {
    attributes.isExternal = false;
    attributeConfidence.isExternal = DEFAULTED_ATTRIBUTE_CONFIDENCE;
    attributeRefs.isExternal = rowRange;
  }
}

/**
 * §5.2 step 3 + the "Intra-document duplicates" paragraph, together: one
 * pass builds every group (elements, actors, and the relationship requests
 * that reference them), then three emission phases assign stable `seq`
 * numbers — elements first, then actors, then relationships — so an
 * `owns` relationship minted alongside its own actor and element can
 * reference both by a `seq` already known to be final.
 */
export function rowsToCandidates(input: RowsToCandidatesInput): RowsToCandidatesResult {
  const { sheetName, sheetType, headers, headerColumnRefs, roles, nameColumnIndex, rawSheet, headerRowIndex } = input;
  const dataRows = extractDataRows(rawSheet, headerRowIndex, nameColumnIndex);
  const parentColIndex = roles.findIndex((r) => r?.role === 'parent');
  const integrationColIndex = roles.findIndex((r) => r?.role === 'integrationPlatform');
  const ownerColIndex = roles.findIndex((r) => r?.role === 'owner');

  const elementGroups = new Map<string, ElementGroup>();
  const actorGroups = new Map<string, ActorGroup>();
  const pendingOwns: PendingOwns[] = [];
  const pendingRelationships: PendingRelationship[] = [];

  for (const row of dataRows) {
    const name = (row.cells[nameColumnIndex] ?? '').trim();
    if (name === '') continue;

    const passage = rowPassage(headers, row.cells);
    const nameAssignment = roles[nameColumnIndex];
    const nameRef = cellRef(sheetName, headerColumnRefs, nameColumnIndex, row.rowNumber);
    const nameRowFactor = rowFactorFor(Boolean(row.cellMeta.get(nameColumnIndex)?.merged) || Boolean(row.cellMeta.get(nameColumnIndex)?.formulaError));
    const nameConfidence = sheetAttrConf({ mappingConfidence: nameAssignment?.confidence ?? 1, parseFactor: 1, rowFactor: nameRowFactor });

    let parentText: string | null = null;
    if (sheetType === 'container' && parentColIndex >= 0) {
      const raw = (row.cells[parentColIndex] ?? '').trim();
      if (raw !== '') parentText = raw;
    }

    const key = elementGroupKey(sheetType, name, parentText);
    let group = elementGroups.get(key);
    if (!group) {
      group = {
        seq: -1,
        elementType: sheetType,
        name,
        nameConfidence,
        nameRef,
        firstRowNumber: row.rowNumber,
        parentText,
        attributes: new Map(),
        warnings: [],
        passages: [],
        aliasProposals: [],
        sourceKeys: [],
      };
      elementGroups.set(key, group);
    }
    group.passages.push(passage);
    group.aliasProposals.push({ type: 'name', value: name });

    for (let c = 0; c < headers.length; c++) {
      const assignment = roles[c];
      if (!assignment) continue;
      const role = assignment.role;
      if (role === 'ignore' || role === 'name' || role === 'notes' || role === 'parent' || role === 'integrationPlatform') continue;

      const raw = (row.cells[c] ?? '').trim();
      const meta = row.cellMeta.get(c);
      const ref = cellRef(sheetName, headerColumnRefs, c, row.rowNumber);
      const refText = ref.kind === 'sheet' ? ref.range : '';
      const baseWarnings = cellWarnings(meta, refText);
      const rowFactor = rowFactorFor(Boolean(meta?.merged) || Boolean(meta?.formulaError));
      const isFirst = !group.attributes.has(role);
      /** `cellToString` (`parse/spreadsheet.ts`) reads a formula-error cell as `''` — indistinguishable from a genuinely blank one to every `if (raw === '') continue` guard below, which would otherwise let `FORMULA_ERROR` (already computed into `baseWarnings`, via `cellWarnings`) get discarded unused rather than ever reaching a candidate. Recorded on the element itself, since there is no parsed value for `recordAttribute` to attach it to. */
      const bailOnBlank = (): void => {
        if (meta?.formulaError) group.warnings.push({ code: 'FORMULA_ERROR', cell: refText });
      };

      if (role === 'atlasId') {
        if (raw !== '') group.atlasId = raw;
        continue;
      }
      if (role === 'sourceKey') {
        if (raw === '') continue;
        group.sourceKeys.push(raw);
        group.aliasProposals.push({ type: 'source_system_key', value: raw });
        continue;
      }
      if (role === 'capability') {
        if (raw !== '' && group.capabilityColumnText === undefined) {
          group.capabilityColumnText = raw;
          group.capabilityColumnRef = ref;
        }
        continue;
      }

      if (PLAIN_ATTRIBUTES.has(role)) {
        if (raw === '') {
          bailOnBlank();
          continue;
        }
        const { value, multiValue } = collapseMultiValue(raw);
        const warnings = multiValue ? [...baseWarnings, { code: 'MULTI_VALUE_CELL', cell: refText } as const] : baseWarnings;
        recordAttribute(group, role, value, warnings, rowFactor, assignment.confidence, ref, isFirst);
        continue;
      }
      if (role === 'lifecycleStatus') {
        if (raw === '') {
          bailOnBlank();
          continue;
        }
        const parsed = parseLifecycle(raw);
        if (!parsed) {
          group.warnings.push({ code: 'ENUM_UNPARSED', cell: refText, raw });
          continue;
        }
        const warnings = parsed.fuzzy ? [...baseWarnings, { code: 'ENUM_FUZZY', cell: refText, raw, parsedAs: parsed.value } as const] : baseWarnings;
        recordAttribute(group, 'lifecycleStatus', parsed.value, warnings, rowFactor, assignment.confidence, ref, isFirst);
        continue;
      }
      if (role === 'hostingModel') {
        if (raw === '') {
          bailOnBlank();
          continue;
        }
        const parsed = parseHostingModel(raw);
        if (!parsed) {
          group.warnings.push({ code: 'ENUM_UNPARSED', cell: refText, raw });
          continue;
        }
        const warnings = parsed.fuzzy ? [...baseWarnings, { code: 'ENUM_FUZZY', cell: refText, raw, parsedAs: parsed.value } as const] : baseWarnings;
        recordAttribute(group, 'hostingModel', parsed.value, warnings, rowFactor, assignment.confidence, ref, isFirst);
        continue;
      }
      if (role === 'introduced' || role === 'plannedEnd') {
        if (raw === '') {
          bailOnBlank();
          continue;
        }
        const parsed = parseDate(raw);
        if (!parsed) continue;
        const warnings = parsed.ambiguous ? [...baseWarnings, { code: 'AMBIGUOUS_DATE', cell: refText, parsedAs: parsed.value } as const] : baseWarnings;
        recordAttribute(group, role, parsed.value, warnings, rowFactor, assignment.confidence, ref, isFirst);
        continue;
      }
      if (role === 'isExternal') {
        if (raw === '') {
          bailOnBlank();
          continue;
        }
        const parsed = parseBool(raw);
        if (parsed === null) continue;
        recordAttribute(group, 'isExternal', parsed, baseWarnings, rowFactor, assignment.confidence, ref, isFirst);
        continue;
      }

      if (role === 'owner' || role === 'technicalOwner') {
        if (raw === '') continue;
        const aKey = actorGroupKey(raw);
        let actor = actorGroups.get(aKey);
        if (!actor) {
          actor = { seq: -1, name: raw, nameConfidence: DEFAULTED_ATTRIBUTE_CONFIDENCE, nameRef: ref, subtype: looksLikePersonName(raw) ? 'person' : 'team', warnings: [], passages: [], aliasProposals: [{ type: 'name', value: raw }] };
          actorGroups.set(aKey, actor);
        }
        actor.passages.push(passage);
        pendingOwns.push({ ownerGroupKey: aKey, elementGroupKey: key, role: role === 'owner' ? 'business' : 'technical', roleConfidence: assignment.confidence, ref, passage });
        continue;
      }
      if (role === 'ownerEmail') {
        if (raw === '') continue;
        const email = parseEmail(raw);
        if (!email) continue;
        // Attaches to whichever actor this row's own `owner` column just produced — a row with `ownerEmail` but no `owner` column has nothing to attach to.
        const ownerRaw = ownerColIndex >= 0 ? (row.cells[ownerColIndex] ?? '').trim() : '';
        if (ownerRaw === '') continue;
        const actor = actorGroups.get(actorGroupKey(ownerRaw));
        if (!actor) continue;
        actor.email = email;
        actor.subtype = 'person';
        actor.emailConfidence = sheetAttrConf({ mappingConfidence: assignment.confidence, parseFactor: 1, rowFactor });
        actor.emailRef = ref;
        continue;
      }

      if (role === 'usesSystems' || role === 'flowsTo') {
        if (raw === '') continue;
        const relationshipType = role === 'usesSystems' ? 'uses' : 'flows_to';
        const viaText = integrationColIndex >= 0 ? (row.cells[integrationColIndex] ?? '').trim() || undefined : undefined;
        for (const piece of raw
          .split(LIST_SPLIT_PATTERN)
          .map((p) => p.trim())
          .filter((p) => p !== '')) {
          pendingRelationships.push({ relationshipType, fromElementGroupKey: key, toText: piece, viaText, ref, passage });
        }
      }
    }
  }

  // --- Phase 2: emit element candidates. ---
  const candidates: RowCandidate[] = [];
  const capabilityRows: CapabilityColumnRow[] = [];
  let nextSeq = 0;

  for (const group of elementGroups.values()) {
    group.seq = nextSeq++;
    const { name: finalName, stemAlias } = parseName(group.name);
    const attributes: Record<string, unknown> = {};
    const attributeConfidence: Record<string, number> = { name: group.nameConfidence };
    const attributeRefs: Record<string, SourceRef> = { name: group.nameRef };
    for (const [attr, state] of group.attributes) {
      attributes[attr] = state.value;
      attributeConfidence[attr] = state.confidence;
      attributeRefs[attr] = state.ref;
    }
    applyRequiredDefaults(group.elementType, attributes, attributeConfidence, attributeRefs, rowRangeRef(sheetName, headerColumnRefs, group.firstRowNumber));

    const proposal: ElementProposal = {
      kind: 'element',
      elementType: group.elementType,
      name: finalName,
      parent: group.parentText ? { kind: 'unresolved', text: group.parentText } : null,
      attributes,
    };
    const aliasProposals = stemAlias ? [...group.aliasProposals, { type: 'name' as const, value: stemAlias }] : group.aliasProposals;

    const evidence: CandidateEvidence = {
      sourceRef: group.nameRef,
      passage: group.passages.join('\n'),
      extractor: 'sheet-mapping',
      attributeRefs,
      attributeConfidence,
      warnings: group.warnings,
    };

    candidates.push({
      seq: group.seq,
      proposal,
      evidence,
      matchHints: { ...(group.atlasId ? { atlasId: group.atlasId } : {}), ...(group.sourceKeys.length > 0 ? { sourceKeys: group.sourceKeys } : {}) },
      aliasProposals,
    });

    if (group.capabilityColumnText !== undefined && group.capabilityColumnRef !== undefined) {
      const rowDescription = attributes.description;
      capabilityRows.push({
        seq: group.seq,
        systemName: finalName,
        ...(typeof rowDescription === 'string' ? { description: rowDescription } : {}),
        capabilityText: group.capabilityColumnText,
        sourceRef: group.capabilityColumnRef,
      });
    }
  }

  // --- Phase 3: emit actor candidates. ---
  for (const actor of actorGroups.values()) {
    actor.seq = nextSeq++;
    const attributes: Record<string, unknown> = { subtype: actor.subtype, isExternal: false };
    const attributeConfidence: Record<string, number> = { subtype: DEFAULTED_ATTRIBUTE_CONFIDENCE, isExternal: DEFAULTED_ATTRIBUTE_CONFIDENCE, name: actor.nameConfidence };
    const attributeRefs: Record<string, SourceRef> = { subtype: actor.nameRef, isExternal: actor.nameRef, name: actor.nameRef };
    if (actor.email) {
      attributes.email = actor.email;
      attributeConfidence.email = actor.emailConfidence ?? DEFAULTED_ATTRIBUTE_CONFIDENCE;
      attributeRefs.email = actor.emailRef ?? actor.nameRef;
    }

    const proposal: ElementProposal = { kind: 'element', elementType: 'actor', name: actor.name, parent: null, attributes };
    const evidence: CandidateEvidence = {
      sourceRef: actor.nameRef,
      passage: actor.passages.join('\n'),
      extractor: 'sheet-mapping',
      attributeRefs,
      attributeConfidence,
      warnings: actor.warnings,
    };
    candidates.push({ seq: actor.seq, proposal, evidence, matchHints: {}, aliasProposals: actor.aliasProposals });
  }

  // --- Phase 4: emit relationship candidates. ---
  for (const pending of pendingOwns) {
    const fromSeq = actorGroups.get(pending.ownerGroupKey)?.seq;
    const toSeq = elementGroups.get(pending.elementGroupKey)?.seq;
    if (fromSeq === undefined || toSeq === undefined) continue;
    const proposal: RelationshipProposal<'owns'> = { kind: 'relationship', relationshipType: 'owns', from: { kind: 'candidate', seq: fromSeq }, to: { kind: 'candidate', seq: toSeq }, attributes: { role: pending.role } };
    const evidence: CandidateEvidence = { sourceRef: pending.ref, passage: pending.passage, extractor: 'sheet-mapping', attributeConfidence: { role: pending.roleConfidence }, warnings: [] };
    candidates.push({ seq: nextSeq++, proposal, evidence, aliasProposals: [] });
  }
  for (const pending of pendingRelationships) {
    const fromSeq = elementGroups.get(pending.fromElementGroupKey)?.seq;
    if (fromSeq === undefined) continue;
    const proposal: RelationshipProposal<'uses' | 'flows_to'> = { kind: 'relationship', relationshipType: pending.relationshipType, from: { kind: 'candidate', seq: fromSeq }, to: { kind: 'unresolved', text: pending.toText }, attributes: {} };
    const evidence: CandidateEvidence = { sourceRef: pending.ref, passage: pending.passage, extractor: 'sheet-mapping', attributeConfidence: {}, warnings: [] };
    candidates.push({ seq: nextSeq++, proposal, evidence, ...(pending.viaText ? { viaHint: pending.viaText } : {}), aliasProposals: [] });
  }

  return { candidates, capabilityRows };
}

/** Records an attribute's first-seen value, or (on a later duplicate row) checks agreement and warns `ROWS_DISAGREE` without overwriting the survivor's own first value — §5.2's own "union where rows agree, first row's value... where they don't" rule. */
function recordAttribute(group: ElementGroup, attr: string, value: unknown, warnings: EvidenceWarning[], rowFactor: number, mappingConfidence: number, ref: SourceRef, isFirst: boolean): void {
  if (isFirst) {
    const parseFactor = parseFactorFor(warnings.map((w) => w.code));
    const confidence = sheetAttrConf({ mappingConfidence, parseFactor, rowFactor });
    group.attributes.set(attr, { value, confidence, ref });
    group.warnings.push(...warnings);
    return;
  }
  const existing = group.attributes.get(attr);
  if (existing && !deepEqualJsonLoose(existing.value, value)) {
    const cell = ref.kind === 'sheet' ? ref.range : '';
    group.warnings.push({ code: 'ROWS_DISAGREE', cell });
  }
}
