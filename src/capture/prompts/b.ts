/**
 * F2 (full K1), SPEC-capture.md §6.2: prompt B — extraction from prose (PDF
 * and pasted text). Frozen system prompt, its schema, and the pure builder
 * for the volatile per-chunk user turn.
 */

export const PROMPT_B_SYSTEM = `You extract enterprise-architecture facts from documents into a fixed taxonomy. You are a
careful clerk, not an analyst: record what the text says, quote where it says it, and leave out
what it does not say.

Element types (with the attributes you may fill):
- capability: name, description, parentName
- system: name, description, vendor, lifecycleStatus (planned|active|retiring|retired),
  isExternal (true|false), externalOrganisation, introduced (date), plannedEnd (date)
- container: name, description, technology, parentName (the system it is part of), isExternal
- actor: name, subtype (person|team), email, orgUnit, isExternal, externalOrganisation

Relationship types (from → to):
- supports: system → capability. "The X system supports the Y function / service / area."
- uses: system|container → system|container. A runtime dependency.
- owns: actor → capability|system. Accountability: "owned by", "the X team are responsible for".
- flows_to: system|container → system|container. Data or integration flow: "sends", "feeds",
  "exports to".

Not in the taxonomy — never emit these as elements: business processes and workflow steps,
data entities, infrastructure (servers, networks, racks), projects and programmes, goals and
KPIs, requirements, costs and budgets, risks, service-catalogue entries, maturity scores,
reporting lines. A project that introduces a system is evidence about the system, not an element.

Evidence rules — these are strict:
- Every fact (each element, each attribute value, each relationship) carries a passage: the
  exact text from the document it rests on, copied verbatim, at most 300 characters, without
  ellipses or paraphrase. The pipeline verifies each passage against the document and discards
  any fact whose passage is not found.
- One passage may support several facts. Do not stretch a passage to cover a fact it doesn't
  state.
- confidence is a number in [0, 1]: how clearly the passage states the fact. A vendor named in a
  table row is ~0.9; a status inferred from "we are moving away from" is ~0.6; a guess is < 0.4
  and you should usually omit it instead.
- Use the document's own names for elements. Do not normalise, expand acronyms, or merge two
  differently named things — matching is done later, by code, against the organisation's model.
- Dates: copy the document's wording into passage and give the date as ISO (YYYY-MM-DD) in the
  value; a bare year is YYYY-01-01.
- If the chunk contains nothing in the taxonomy, return empty lists.`;

export const PROMPT_B_ELEMENT_TYPES = ['capability', 'system', 'container', 'actor'] as const;
export const PROMPT_B_RELATIONSHIP_TYPES = ['supports', 'uses', 'owns', 'flows_to'] as const;

const promptBAttributeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'value', 'passage', 'confidence'],
  properties: {
    key: { type: 'string' },
    value: { anyOf: [{ type: 'string' }, { type: 'boolean' }] },
    passage: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

/** §6.2's schema block: `{ elements: [...], relationships: [...] }`, strict. */
export const PROMPT_B_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['elements', 'relationships'],
  properties: {
    elements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['elementType', 'name', 'namePassage', 'nameConfidence', 'parentName', 'attributes'],
        properties: {
          elementType: { type: 'string', enum: [...PROMPT_B_ELEMENT_TYPES] },
          name: { type: 'string' },
          namePassage: { type: 'string' },
          nameConfidence: { type: 'number', minimum: 0, maximum: 1 },
          parentName: { type: ['string', 'null'] },
          attributes: { type: 'array', items: promptBAttributeSchema },
        },
      },
    },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['relationshipType', 'fromName', 'toName', 'passage', 'confidence', 'attributes'],
        properties: {
          relationshipType: { type: 'string', enum: [...PROMPT_B_RELATIONSHIP_TYPES] },
          fromName: { type: 'string' },
          toName: { type: 'string' },
          passage: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          attributes: { type: 'array', items: promptBAttributeSchema },
        },
      },
    },
  },
} as const;

export type PromptBChunkLocation =
  | { kind: 'pages'; first: number; last: number; total: number }
  | { kind: 'pastedText'; start: number; end: number; total: number };

export interface BuildPromptBUserMessageInput {
  inputName: string;
  location: PromptBChunkLocation;
  /** §6.2: "names only, for parentName and relationship endpoints" — omitted line entirely on a document's first chunk. */
  priorElementNames?: readonly string[];
  chunkText: string;
}

function formatLocation(location: PromptBChunkLocation): string {
  return location.kind === 'pages' ? `Pages ${String(location.first)}–${String(location.last)} of ${String(location.total)}.` : `Pasted text, characters ${String(location.start)}–${String(location.end)} of ${String(location.total)}.`;
}

/** §6.2's own per-chunk user-turn template, verbatim shape. */
export function buildPromptBUserMessage(input: BuildPromptBUserMessageInput): string {
  const priorLine =
    input.priorElementNames && input.priorElementNames.length > 0
      ? `Elements already found in earlier chunks of this document (names only, for parentName and\n   relationship endpoints — you may refer to them, do not re-emit them unless this chunk adds\n   attributes): ${input.priorElementNames.join(', ')}\n`
      : '';

  return `Document: ${input.inputName}
${formatLocation(input.location)}
${priorLine}
--- BEGIN TEXT ---
${input.chunkText}
--- END TEXT ---`;
}
