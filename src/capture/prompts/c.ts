/**
 * F2 (full K1), SPEC-capture.md §6.3: prompt C — capability assignment
 * (closed vocabulary). Used only when §7's alias/name+context match against
 * the model's capabilities fails or is ambiguous (PR6 wires the call site);
 * this file only owns the frozen prompt, its schema, and the pure builders.
 */

export const PROMPT_C_SYSTEM = `You assign rows from a system inventory to capabilities in an organisation's capability map.

You will be given the organisation's capability tree: each capability has a stable code, a name,
its parent, and a one-sentence definition. Choose from this tree only. If no capability fits,
answer none — do not propose a new capability.

For each row you are given the system's name, the text from its business-area / service /
function column, and its description if any. Choose the single most specific capability that the
system directly supports. Prefer a level-2 capability to its level-1 parent when the row's text
makes the level-2 clear; choose the level-1 when it doesn't. If the row's text names two
capabilities, return both, most specific first.

confidence is in [0, 1]: 0.9+ when the row's text is a near-restatement of the capability's name
or definition; ~0.7 when the mapping is a reasonable reading; below 0.5, answer none instead.`;

/** §6.3's schema block: `{ assignments: [{ seq, capabilities: [{ code, confidence }] }] }`, strict. */
export const PROMPT_C_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assignments'],
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['seq', 'capabilities'],
        properties: {
          seq: { type: 'number' },
          capabilities: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['code', 'confidence'],
              properties: {
                code: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
            },
          },
        },
      },
    },
  },
} as const;

/** One row of the organisation's capability tree — §6.3: "the tree is the stable, cache-controlled part of the system block in practice." */
export interface PromptCCapabilityTreeEntry {
  code: string;
  name: string;
  parentCode: string | null;
  description?: string;
}

export interface PromptCRow {
  seq: number;
  systemName: string;
  /** The row's business-area/service/function column text. */
  capabilityColumnText: string;
  description?: string;
}

/** §6.3: capability tree text, appended to the system block (`system[1]`, cache-controlled) — the stable half of the request. */
export function buildPromptCCapabilityTreeBlock(tree: readonly PromptCCapabilityTreeEntry[]): string {
  return tree.map((entry) => `${entry.code} | ${entry.name} | parent: ${entry.parentCode ?? '(none)'} | ${entry.description ?? ''}`).join('\n');
}

const DESCRIPTION_TRUNCATE_LENGTH = 200;

/** §6.3's own per-batch user-turn template (≤ 50 rows, enforced by the caller — PR6). */
export function buildPromptCUserMessage(rows: readonly PromptCRow[]): string {
  const lines = rows.map((row) => {
    const description = row.description && row.description.length > DESCRIPTION_TRUNCATE_LENGTH ? `${row.description.slice(0, DESCRIPTION_TRUNCATE_LENGTH)}…` : (row.description ?? '');
    return `${String(row.seq)} | ${row.systemName} | ${row.capabilityColumnText} | ${description}`;
  });
  return `Rows:\n${lines.join('\n')}`;
}
