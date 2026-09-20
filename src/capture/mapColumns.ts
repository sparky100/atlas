/**
 * F2 (full K1), SPEC-capture.md §5.2 step 2 / §6.1: the LLM half of column
 * mapping — prompt A, called once per sheet only for the headers the
 * synonym table (`columnSynonyms.ts`) missed. `mapSheetColumns` is the one
 * function a caller (`rowsToCandidates.ts`'s own caller, later PRs) needs:
 * it runs the synonym pass, calls prompt A only if anything is left
 * unmapped, and returns the same shape `resolveColumnRoles` does either way.
 */
import { z } from 'zod';
import { clampMappingConfidence } from './confidence';
import { lookupColumnSynonym, resolveColumnRoles, type LlmColumnAssignment, type ResolveColumnRolesResult } from './columnSynonyms';
import type { LlmClient } from './llm/client';
import { buildPromptAUserMessage, PROMPT_A_COLUMN_ROLES, PROMPT_A_SCHEMA, PROMPT_A_SHEET_TYPES, PROMPT_A_SYSTEM, type PromptAColumnRole, type PromptASheetType } from './prompts/a';

/** §6: "Effort: prompt A `medium`." */
const PROMPT_A_EFFORT = 'medium';

const promptAResponseSchema = z.object({
  sheetType: z.enum(PROMPT_A_SHEET_TYPES),
  columns: z.array(
    z.object({
      column: z.string(),
      role: z.enum(PROMPT_A_COLUMN_ROLES),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
});

export class MapColumnsError extends Error {}

interface UnmappedHeader {
  columnRef: string;
  header: string;
  headerIndex: number;
}

interface MapColumnsViaLlmInput {
  llmClient: LlmClient;
  inputName: string;
  sheetName: string;
  rowCount: number;
  mappedHeaders: readonly { header: string; role: PromptAColumnRole }[];
  unmappedHeaders: readonly UnmappedHeader[];
  /** Aligned to `unmappedHeaders` (not the sheet's own column order) — up to 5 rows. */
  sampleRows: readonly (readonly string[])[];
}

interface MapColumnsViaLlmResult {
  sheetType: PromptASheetType;
  assignments: ReadonlyMap<number, LlmColumnAssignment>;
}

/** One prompt-A call. `LLM_SCHEMA_INVALID` (§11): structured outputs should make this defensive-only, but a response is still parsed and validated, never trusted blind. */
async function mapColumnsViaLlm(input: MapColumnsViaLlmInput): Promise<MapColumnsViaLlmResult> {
  const userMessage = buildPromptAUserMessage({
    inputName: input.inputName,
    sheetName: input.sheetName,
    rowCount: input.rowCount,
    mappedHeaders: input.mappedHeaders,
    unmappedHeaders: input.unmappedHeaders.map((h) => ({ columnRef: h.columnRef, header: h.header })),
    sampleRows: input.sampleRows,
  });

  const response = await input.llmClient.complete({
    effort: PROMPT_A_EFFORT,
    system: PROMPT_A_SYSTEM,
    format: { type: 'json_schema', schema: PROMPT_A_SCHEMA },
    messages: [{ role: 'user', content: userMessage }],
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch (e) {
    throw new MapColumnsError(`Prompt A response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const result = promptAResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new MapColumnsError(`Prompt A response failed schema validation: ${result.error.message}`);
  }

  const headerIndexByColumnRef = new Map(input.unmappedHeaders.map((h) => [h.columnRef, h.headerIndex]));
  const assignments = new Map<number, LlmColumnAssignment>();
  for (const column of result.data.columns) {
    const headerIndex = headerIndexByColumnRef.get(column.column);
    // The model named a column we never asked about — ignore rather than fail the whole sheet over it.
    if (headerIndex === undefined) continue;
    assignments.set(headerIndex, { role: column.role, confidence: clampMappingConfidence(column.confidence) });
  }

  return { sheetType: result.data.sheetType, assignments };
}

export interface MapSheetColumnsInput {
  llmClient: LlmClient;
  inputName: string;
  sheetName: string;
  rowCount: number;
  /** Aligned by column index; `''` for a blank header cell. */
  headers: readonly string[];
  /** A1 column letters, aligned to `headers`. */
  headerColumnRefs: readonly string[];
  /** Up to 5 sample data rows, each aligned to `headers` — only unmapped columns' values are actually sent to the model. */
  sampleRows: readonly (readonly string[])[];
}

export interface MapSheetColumnsResult extends ResolveColumnRolesResult {
  /** `null` when every header had a synonym hit — no prompt A call was made, so the sheet-type heuristic (`rowsToCandidates.ts`'s caller) decides alone. */
  llmSheetType: PromptASheetType | null;
}

const SAMPLE_ROW_COUNT = 5;

/** §5.2 step 2, whole: synonym table first; prompt A only for what's left, and only if anything is left at all (an all-synonym sheet never calls the model). */
export async function mapSheetColumns(input: MapSheetColumnsInput): Promise<MapSheetColumnsResult> {
  const mappedHeaders: { header: string; role: PromptAColumnRole }[] = [];
  const unmappedHeaders: UnmappedHeader[] = [];

  for (let i = 0; i < input.headers.length; i++) {
    const header = input.headers[i];
    if (header === undefined || header.trim() === '') continue;
    const synonymRole = lookupColumnSynonym(header);
    if (synonymRole) mappedHeaders.push({ header, role: synonymRole });
    else unmappedHeaders.push({ columnRef: input.headerColumnRefs[i] ?? '', header, headerIndex: i });
  }

  if (unmappedHeaders.length === 0) {
    return { ...resolveColumnRoles({ headers: input.headers }), llmSheetType: null };
  }

  const sampleRowsForUnmapped = input.sampleRows.slice(0, SAMPLE_ROW_COUNT).map((row) => unmappedHeaders.map((h) => row[h.headerIndex] ?? ''));

  const { sheetType, assignments } = await mapColumnsViaLlm({
    llmClient: input.llmClient,
    inputName: input.inputName,
    sheetName: input.sheetName,
    rowCount: input.rowCount,
    mappedHeaders,
    unmappedHeaders,
    sampleRows: sampleRowsForUnmapped,
  });

  return { ...resolveColumnRoles({ headers: input.headers, llmAssignments: assignments }), llmSheetType: sheetType };
}
