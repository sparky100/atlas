/**
 * F2 (full K1) PR11, SPEC-capture.md §5.3/§6.2: prompt B extraction for one
 * already-chunked span of PDF or pasted text — the prose counterpart to
 * `rowsToCandidates.ts`. One call per chunk (`runCapture.ts`, the only
 * caller, threads `priorElementNames` across chunks and offsets `seq`
 * exactly the way it already does across sheets). Produces the same
 * `RowCandidate[]` currency `rowsToCandidates.ts` does, so every downstream
 * stage (`intraDocumentDedup.ts`, `classifyAndResolve()`) is unchanged.
 *
 * Grounding (§5.3, `ground.ts`) decides two different things:
 * - An attribute whose own `passage` doesn't ground is dropped from the
 *   proposal (`PASSAGE_NOT_FOUND`) — the rest of the candidate survives.
 * - An element whose `namePassage` doesn't ground, or a relationship whose
 *   own top-level `passage` doesn't ground, makes the *whole* candidate
 *   `RowCandidate.ungrounded` — `runCapture.ts` classifies these `unsourced`
 *   before any matching is attempted, mirroring `PARENT_UNRESOLVED`'s own
 *   early-return shape. The model's claimed text is kept as `evidence.passage`
 *   for the reviewer either way (§11).
 *
 * Scope, disclosed:
 * - `attributes[].key` is checked against a per-type allowlist derived from
 *   `PROMPT_B_SYSTEM`'s own documented attribute lists (never the full
 *   `ElementAttributesByType`/`RelationshipAttributesByType` contract shape —
 *   the model was never told about a wider vocabulary, e.g. `criticality`,
 *   `via`, `dataClassification`, so it has no way to emit those keys
 *   legitimately; one that does anyway is `UNKNOWN_ATTRIBUTE_KEY`, per §6.2's
 *   own "dropped with a warning, never stored").
 * - `supports.role`/`owns.role` are never asked of the model (undocumented
 *   in `PROMPT_B_SYSTEM`) — defaulted the same way the spreadsheet path
 *   already defaults them (`capabilityAssignment.ts`'s `'secondary'`,
 *   `rowsToCandidates.ts`'s owner-column `'business'`) unless a future
 *   prompt revision adds one and the model supplies a valid enum value.
 * - `uses`/`flows_to`'s own `via` is never a prose attribute at all (same
 *   reasoning as `role`) — an integration platform named only in prose has
 *   no `RowCandidate.viaHint`-equivalent extraction path in this PR.
 * - An unparseable attribute value (a `lifecycleStatus` outside the closed
 *   vocabulary, a non-ISO date, an unparseable boolean) is dropped silently,
 *   the same "never guess" convention `rowsToCandidates.ts` already uses for
 *   an unparseable `isExternal`/date cell — no warning code in §4.3's own
 *   union is shaped for a passage rather than a cell, and inventing one for
 *   a case §5.3 doesn't call out would outrun what the spec actually asks
 *   for.
 */
import { z } from 'zod';
import type { ElementProposal, EvidenceWarning, RelationshipProposal } from '../contracts/capture';
import type { ActorSubtype, ElementType, LifecycleStatus, OwnsRole, RelationshipType, SupportsRole } from '../contracts/delta';
import type { SourceRef } from '../contracts/sourceRef';
import { DEFAULTED_ATTRIBUTE_CONFIDENCE, groundingFactorFor, proseAttrConf } from './confidence';
import { groundPassage } from './ground';
import type { LlmClient } from './llm/client';
import { normaliseName } from './normalise';
import { parseBool, parseDate, parseEmail, parseName } from './normaliseValue';
import { buildPromptBUserMessage, PROMPT_B_ELEMENT_TYPES, PROMPT_B_RELATIONSHIP_TYPES, PROMPT_B_SCHEMA, PROMPT_B_SYSTEM, type PromptBChunkLocation } from './prompts/b';
import { applyRequiredDefaults, type RowCandidate } from './rowsToCandidates';

export class ExtractProseError extends Error {}

/** §6: "Effort: prompt B `high`." */
const PROMPT_B_EFFORT = 'high';

const promptBAttributeResponseSchema = z.object({
  key: z.string(),
  value: z.union([z.string(), z.boolean()]),
  passage: z.string(),
  confidence: z.number().min(0).max(1),
});

const promptBResponseSchema = z.object({
  elements: z.array(
    z.object({
      elementType: z.enum(PROMPT_B_ELEMENT_TYPES),
      name: z.string(),
      namePassage: z.string(),
      nameConfidence: z.number().min(0).max(1),
      parentName: z.string().nullable(),
      attributes: z.array(promptBAttributeResponseSchema),
    }),
  ),
  relationships: z.array(
    z.object({
      relationshipType: z.enum(PROMPT_B_RELATIONSHIP_TYPES),
      fromName: z.string(),
      toName: z.string(),
      passage: z.string(),
      confidence: z.number().min(0).max(1),
      attributes: z.array(promptBAttributeResponseSchema),
    }),
  ),
});

type PromptBRawAttribute = z.infer<typeof promptBAttributeResponseSchema>;
type PromptBRawElement = z.infer<typeof promptBResponseSchema>['elements'][number];
type PromptBRawRelationship = z.infer<typeof promptBResponseSchema>['relationships'][number];

// ---------------------------------------------------------------------------
// Per-key value parsing — one function per attribute shape, shared across
// every element/relationship type that uses it. `null` means "drop, never
// guess" (rule 5's own "no fact without provenance" extends naturally to "no
// fact with a value nobody actually stated").
// ---------------------------------------------------------------------------

type AttributeValueParser = (raw: string | boolean) => unknown;

function parsePlainString(raw: string | boolean): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

function parseIsoDate(raw: string | boolean): string | null {
  if (typeof raw !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return parseDate(raw)?.value ?? null;
}

function parseBooleanAttribute(raw: string | boolean): boolean | null {
  return typeof raw === 'boolean' ? raw : parseBool(raw);
}

function parseEnumAttribute<T extends string>(raw: string | boolean, allowed: readonly T[]): T | null {
  if (typeof raw !== 'string') return null;
  const normalised = raw.trim().toLowerCase();
  return allowed.find((value) => value.toLowerCase() === normalised) ?? null;
}

function parseEmailAttribute(raw: string | boolean): string | null {
  return typeof raw === 'string' ? parseEmail(raw) : null;
}

const LIFECYCLE_STATUS_VALUES: readonly LifecycleStatus[] = ['planned', 'active', 'retiring', 'retired'];
const ACTOR_SUBTYPE_VALUES: readonly ActorSubtype[] = ['person', 'team', 'organisation'];
const SUPPORTS_ROLE_VALUES: readonly SupportsRole[] = ['primary', 'secondary'];
const OWNS_ROLE_VALUES: readonly OwnsRole[] = ['business', 'technical', 'service'];

/** §6.2's own attribute lists (`PROMPT_B_SYSTEM`), one parser per key the model was actually told about. */
const ELEMENT_ATTRIBUTE_PARSERS: Readonly<Record<ElementType, Readonly<Record<string, AttributeValueParser>>>> = {
  capability: { description: parsePlainString },
  system: {
    description: parsePlainString,
    vendor: parsePlainString,
    lifecycleStatus: (raw) => parseEnumAttribute(raw, LIFECYCLE_STATUS_VALUES),
    isExternal: parseBooleanAttribute,
    externalOrganisation: parsePlainString,
    introduced: parseIsoDate,
    plannedEnd: parseIsoDate,
  },
  container: {
    description: parsePlainString,
    technology: parsePlainString,
    isExternal: parseBooleanAttribute,
  },
  actor: {
    subtype: (raw) => parseEnumAttribute(raw, ACTOR_SUBTYPE_VALUES),
    email: parseEmailAttribute,
    orgUnit: parsePlainString,
    isExternal: parseBooleanAttribute,
    externalOrganisation: parsePlainString,
  },
};

/** `role` is never asked of the model (see module comment) but is a real contract key on both types — accepted if a future prompt revision ever supplies it, defaulted otherwise (`applyRoleDefault`). `owns` has no `description` attribute at all (`OwnsAttributes`). */
const RELATIONSHIP_ATTRIBUTE_PARSERS: Readonly<Record<RelationshipType, Readonly<Record<string, AttributeValueParser>>>> = {
  supports: { description: parsePlainString, role: (raw) => parseEnumAttribute(raw, SUPPORTS_ROLE_VALUES) },
  uses: { description: parsePlainString },
  owns: { role: (raw) => parseEnumAttribute(raw, OWNS_ROLE_VALUES) },
  flows_to: { description: parsePlainString },
  replaces: { description: parsePlainString },
};

// ---------------------------------------------------------------------------
// Grounding + attribute assembly, shared between element and relationship
// candidates (both carry the same `{key,value,passage,confidence}[]` shape).
// ---------------------------------------------------------------------------

interface GroundedAttributes {
  values: Record<string, unknown>;
  confidence: Record<string, number>;
  refs: Record<string, SourceRef>;
}

function groundAttributes(rawAttributes: readonly PromptBRawAttribute[], parsers: Readonly<Record<string, AttributeValueParser>>, chunkText: string, sourceRefForOffset: (start: number, end: number) => SourceRef, warnings: EvidenceWarning[]): GroundedAttributes {
  const values: Record<string, unknown> = {};
  const confidence: Record<string, number> = {};
  const refs: Record<string, SourceRef> = {};

  for (const raw of rawAttributes) {
    const parser = parsers[raw.key];
    if (!parser) {
      warnings.push({ code: 'UNKNOWN_ATTRIBUTE_KEY', key: raw.key });
      continue;
    }
    if (raw.key in values) continue; // first-seen wins, §5.2's own duplicate-row rule extended to a duplicate key within one candidate.

    const ground = groundPassage(chunkText, raw.passage);
    if (!ground.found) {
      warnings.push({ code: 'PASSAGE_NOT_FOUND', field: raw.key });
      continue;
    }

    const value = parser(raw.value);
    if (value === null) continue;

    values[raw.key] = value;
    confidence[raw.key] = proseAttrConf({ modelConfidence: raw.confidence, groundingFactor: groundingFactorFor(ground.normalised) });
    refs[raw.key] = sourceRefForOffset(ground.start, ground.end);
  }

  return { values, confidence, refs };
}

function applyRoleDefault(relationshipType: RelationshipType, grounded: GroundedAttributes, fallbackRef: SourceRef): void {
  if (relationshipType === 'supports' && grounded.values.role === undefined) {
    grounded.values.role = 'secondary';
    grounded.confidence.role = DEFAULTED_ATTRIBUTE_CONFIDENCE;
    grounded.refs.role = fallbackRef;
  }
  if (relationshipType === 'owns' && grounded.values.role === undefined) {
    grounded.values.role = 'business';
    grounded.confidence.role = DEFAULTED_ATTRIBUTE_CONFIDENCE;
    grounded.refs.role = fallbackRef;
  }
}

// ---------------------------------------------------------------------------
// Element / relationship candidate construction.
// ---------------------------------------------------------------------------

interface BuiltCandidate {
  candidate: RowCandidate;
  /** The candidate's own defining passage's start offset in `chunkText` — §4.5's own sort key; `Number.POSITIVE_INFINITY` when ungrounded (sorts after every real passage, stable among themselves). */
  offset: number;
}

function buildElementCandidate(raw: PromptBRawElement, chunkText: string, sourceRefForOffset: (start: number, end: number) => SourceRef): BuiltCandidate {
  const warnings: EvidenceWarning[] = [];
  const nameGround = groundPassage(chunkText, raw.namePassage);
  const ungrounded = !nameGround.found;
  if (ungrounded) warnings.push({ code: 'PASSAGE_NOT_FOUND', field: 'name' });

  const topPassageText = nameGround.found ? chunkText.slice(nameGround.start, nameGround.end) : raw.namePassage;
  const topSourceRef = nameGround.found ? sourceRefForOffset(nameGround.start, nameGround.end) : sourceRefForOffset(0, chunkText.length);
  const nameConfidence = ungrounded ? 0 : proseAttrConf({ modelConfidence: raw.nameConfidence, groundingFactor: groundingFactorFor(nameGround.normalised) });

  const { name: finalName, stemAlias } = parseName(raw.name);
  const grounded = groundAttributes(raw.attributes, ELEMENT_ATTRIBUTE_PARSERS[raw.elementType], chunkText, sourceRefForOffset, warnings);

  const attributes: Record<string, unknown> = { ...grounded.values };
  const attributeConfidence: Record<string, number> = { ...grounded.confidence, name: nameConfidence };
  const attributeRefs: Record<string, SourceRef> = { ...grounded.refs, name: topSourceRef };
  applyRequiredDefaults(raw.elementType, attributes, attributeConfidence, attributeRefs, topSourceRef);

  const proposal: ElementProposal = {
    kind: 'element',
    elementType: raw.elementType,
    name: finalName,
    parent: raw.parentName !== null && raw.parentName.trim() !== '' ? { kind: 'unresolved', text: raw.parentName } : null,
    attributes,
  };

  const aliasProposals = stemAlias && normaliseName(stemAlias) !== normaliseName(finalName) ? [{ type: 'name' as const, value: raw.name }, { type: 'name' as const, value: stemAlias }] : [{ type: 'name' as const, value: raw.name }];

  const candidate: RowCandidate = {
    seq: -1,
    proposal,
    evidence: { sourceRef: topSourceRef, passage: topPassageText, extractor: 'prose-llm', attributeRefs, attributeConfidence, warnings },
    matchHints: {},
    aliasProposals,
    ...(ungrounded ? { ungrounded: true } : {}),
  };
  return { candidate, offset: nameGround.found ? nameGround.start : Number.POSITIVE_INFINITY };
}

function buildRelationshipCandidate(raw: PromptBRawRelationship, chunkText: string, sourceRefForOffset: (start: number, end: number) => SourceRef): BuiltCandidate {
  const warnings: EvidenceWarning[] = [];
  const ground = groundPassage(chunkText, raw.passage);
  const ungrounded = !ground.found;
  if (ungrounded) warnings.push({ code: 'PASSAGE_NOT_FOUND', field: 'relationship' });

  const topPassageText = ground.found ? chunkText.slice(ground.start, ground.end) : raw.passage;
  const topSourceRef = ground.found ? sourceRefForOffset(ground.start, ground.end) : sourceRefForOffset(0, chunkText.length);

  const grounded = groundAttributes(raw.attributes, RELATIONSHIP_ATTRIBUTE_PARSERS[raw.relationshipType], chunkText, sourceRefForOffset, warnings);
  applyRoleDefault(raw.relationshipType, grounded, topSourceRef);

  const proposal: RelationshipProposal = {
    kind: 'relationship',
    relationshipType: raw.relationshipType,
    from: { kind: 'unresolved', text: raw.fromName },
    to: { kind: 'unresolved', text: raw.toName },
    attributes: grounded.values,
  };

  const candidate: RowCandidate = {
    seq: -1,
    proposal,
    evidence: { sourceRef: topSourceRef, passage: topPassageText, extractor: 'prose-llm', attributeRefs: grounded.refs, attributeConfidence: grounded.confidence, warnings },
    aliasProposals: [],
    ...(ungrounded ? { ungrounded: true } : {}),
  };
  return { candidate, offset: ground.found ? ground.start : Number.POSITIVE_INFINITY };
}

// ---------------------------------------------------------------------------
// One chunk, one prompt-B call.
// ---------------------------------------------------------------------------

export interface ExtractProseChunkInput {
  llmClient: LlmClient;
  inputName: string;
  location: PromptBChunkLocation;
  chunkText: string;
  /** §6.2: "names only... you may refer to them, do not re-emit them" — every prior chunk's own grounded element names, in this document. Empty on a document's first chunk. */
  priorElementNames: readonly string[];
  /** Translates an offset pair within `chunkText` into a real `SourceRef` — `pdf:p{page}!{start}-{end}` (page-local) or `text:{start}-{end}` (whole-document) depending on the chunk's own kind. Supplied by `runCapture.ts`, which alone knows which (`chunk.ts`'s own module comment). */
  sourceRefForOffset: (start: number, end: number) => SourceRef;
}

export interface ExtractProseChunkResult {
  candidates: RowCandidate[];
  /** This chunk's own grounded element names — the caller appends these to the next chunk's own `priorElementNames`. */
  elementNames: string[];
}

/** One prompt-B call for one chunk: extract, validate, ground every fact, assemble `RowCandidate[]` in §4.5's own (page, passage start offset) order. */
export async function extractProseChunk(input: ExtractProseChunkInput): Promise<ExtractProseChunkResult> {
  const userMessage = buildPromptBUserMessage({
    inputName: input.inputName,
    location: input.location,
    ...(input.priorElementNames.length > 0 ? { priorElementNames: input.priorElementNames } : {}),
    chunkText: input.chunkText,
  });

  const response = await input.llmClient.complete({
    effort: PROMPT_B_EFFORT,
    system: PROMPT_B_SYSTEM,
    format: { type: 'json_schema', schema: PROMPT_B_SCHEMA },
    stream: true,
    messages: [{ role: 'user', content: userMessage }],
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch (e) {
    throw new ExtractProseError(`Prompt B response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const result = promptBResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new ExtractProseError(`Prompt B response failed schema validation: ${result.error.message}`);
  }

  const built: BuiltCandidate[] = [
    ...result.data.elements.map((raw) => buildElementCandidate(raw, input.chunkText, input.sourceRefForOffset)),
    ...result.data.relationships.map((raw) => buildRelationshipCandidate(raw, input.chunkText, input.sourceRefForOffset)),
  ];
  built.sort((a, b) => a.offset - b.offset);

  const candidates = built.map(({ candidate }, index) => ({ ...candidate, seq: index }));
  const elementNames = candidates.filter((c): c is RowCandidate & { proposal: ElementProposal } => c.proposal.kind === 'element' && c.ungrounded !== true).map((c) => c.proposal.name);

  return { candidates, elementNames };
}
