/**
 * F2 (full K1), SPEC-capture.md §6.1: prompt A — spreadsheet column mapping.
 * Frozen system prompt (verbatim from the spec, with SPEC-capture.md's own
 * component-element-type references corrected against ADR-000's S1 item 18
 * removal — the spec's prose hadn't caught up to that decision), its schema,
 * and the pure builder for the volatile user turn (§6.1's "one per sheet").
 */

export const PROMPT_A_SYSTEM = `You map spreadsheet columns to a fixed set of roles for an enterprise-architecture model.

The model has four element types: capability, system, container, actor. A spreadsheet
sheet usually lists one type. The column roles you may assign are exactly:

  atlasId, sourceKey, name, description, vendor, lifecycleStatus, introduced, plannedEnd,
  isExternal, externalOrganisation, hostingModel, hostingProvider, technology, parent, owner,
  ownerEmail, technicalOwner, capability, usesSystems, flowsTo, replacedBy, integrationPlatform, notes, ignore

Role meanings:
- atlasId: a UUID column written by this product's own export.
- sourceKey: the source system's own stable identifier for the row (asset id, CMDB id, reference).
- name: the element's name. Exactly one column per sheet.
- description: free text describing the element.
- vendor: supplier or product vendor of a system.
- lifecycleStatus: live/planned/retiring/retired style status.
- introduced: date the system went live or was implemented.
- plannedEnd: planned decommission, contract end, or end-of-life date.
- isExternal: whether the system is operated outside the organisation (SaaS, hosted, third party).
- externalOrganisation: who operates it, when external.
- hostingModel: on-premises, private cloud, public cloud, SaaS, or hybrid — a closed set, not free text.
- hostingProvider: the specific hosting provider, data centre or region, when named. Free text, distinct from hostingModel.
- technology: platform or stack of a container.
- parent: the system this container row belongs to.
- owner: the team or person accountable for the row (its business owner).
- ownerEmail: the owner's email.
- technicalOwner: the team or person who runs the row day to day, when distinct from owner.
- capability: a business area, service, function or capability the system supports.
- usesSystems: other systems this one depends on.
- flowsTo: systems this one sends data to.
- replacedBy: the system or module that is replacing this one, when the document names a successor.
- integrationPlatform: the integration platform (ESB, API gateway, message bus) a usesSystems/flowsTo relationship in this row actually goes via, when named.
- notes: commentary to show a reviewer but not to extract.
- ignore: anything else (costs, risk scores, maturity ratings, project names, process steps —
  these are deliberately outside the model).

Rules:
- Assign each header exactly one role. Prefer ignore over a doubtful mapping.
- Your confidence is a number in [0, 1] meaning how sure you are of the role, from the header
  text and the sample values together.
- Never assign name to more than one column; if two columns could be the name, give the second
  one sourceKey or description with a reason.
- sheetType is your best reading of what one row of this sheet is: system, container,
  capability, actor, or unknown.`;

export const PROMPT_A_COLUMN_ROLES = [
  'atlasId',
  'sourceKey',
  'name',
  'description',
  'vendor',
  'lifecycleStatus',
  'introduced',
  'plannedEnd',
  'isExternal',
  'externalOrganisation',
  'hostingModel',
  'hostingProvider',
  'technology',
  'parent',
  'owner',
  'ownerEmail',
  'technicalOwner',
  'capability',
  'usesSystems',
  'flowsTo',
  'replacedBy',
  'integrationPlatform',
  'notes',
  'ignore',
] as const;
export type PromptAColumnRole = (typeof PROMPT_A_COLUMN_ROLES)[number];

export const PROMPT_A_SHEET_TYPES = ['system', 'container', 'capability', 'actor', 'unknown'] as const;
export type PromptASheetType = (typeof PROMPT_A_SHEET_TYPES)[number];

/** §6.1's schema block: `{ sheetType: enum, columns: [{ column, role, confidence, reason }] }`, strict, every field required. */
export const PROMPT_A_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sheetType', 'columns'],
  properties: {
    sheetType: { type: 'string', enum: [...PROMPT_A_SHEET_TYPES] },
    columns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['column', 'role', 'confidence', 'reason'],
        properties: {
          column: { type: 'string' },
          role: { type: 'string', enum: [...PROMPT_A_COLUMN_ROLES] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

export interface PromptAMappedHeader {
  header: string;
  role: PromptAColumnRole;
}

export interface PromptAUnmappedHeader {
  /** The column's A1 letter(s), e.g. `"C"`. */
  columnRef: string;
  header: string;
}

export interface BuildPromptAUserMessageInput {
  inputName: string;
  sheetName: string;
  rowCount: number;
  mappedHeaders: readonly PromptAMappedHeader[];
  unmappedHeaders: readonly PromptAUnmappedHeader[];
  /** Up to 5 rows; each an array of cell values aligned to `unmappedHeaders`, blank cells as `''`. */
  sampleRows: readonly (readonly string[])[];
}

/** §6.1's own user-turn template, verbatim shape — the volatile half, built fresh per sheet, never cache-controlled. */
export function buildPromptAUserMessage(input: BuildPromptAUserMessageInput): string {
  const mappedLines = input.mappedHeaders.length > 0 ? input.mappedHeaders.map((m) => `${m.header} → ${m.role}`).join('\n') : '(none)';
  const unmappedLines = input.unmappedHeaders.length > 0 ? input.unmappedHeaders.map((h) => `column ${h.columnRef}: ${h.header}`).join('\n') : '(none)';
  const sampleLines = input.sampleRows
    .slice(0, 5)
    .map((row) => row.join('|'))
    .join('\n');

  return `Workbook: ${input.inputName}
Sheet: ${input.sheetName} (${String(input.rowCount)} data rows)

Headers already mapped by a synonym table (do not remap these):
${mappedLines}

Headers to map:
${unmappedLines}

Sample rows (values for the unmapped columns only, '|' separated, blank kept as empty):
${sampleLines}`;
}
