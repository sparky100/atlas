import { z } from 'zod';
import { ELEMENT_TYPES } from '../contracts/delta';
import { REPORT_FILTER_OPERATORS, REPORT_SPEC_VERSION, parseReportSpec, type ReportFilter } from '../contracts/reportSpec';
import { clip, DEFAULT_TOOL_ROWS, MAX_COLUMNS, MAX_FILTERS, MAX_TOOL_ROWS } from './limits';
import { isHelperField, runElementReport, rowObjects } from './reportRows';
import { defineTool, failure, okResult } from './toolKit';

const filterSchema = z.strictObject({
  field: z.string().min(1).max(80),
  operator: z.enum(REPORT_FILTER_OPERATORS),
  value: z.union([z.string().max(300), z.number(), z.boolean(), z.array(z.union([z.string().max(300), z.number(), z.boolean()])).max(20), z.null()]),
});

const schema = z.strictObject({
  type: z.enum(ELEMENT_TYPES).optional(),
  filters: z.array(filterSchema).max(MAX_FILTERS).default([]),
  columns: z.array(z.string().min(1).max(80)).max(MAX_COLUMNS).optional(),
  sortBy: z.string().min(1).max(80).default('name'),
  sortDirection: z.enum(['asc', 'desc']).default('asc'),
  limit: z.number().int().min(1).max(MAX_TOOL_ROWS).default(DEFAULT_TOOL_ROWS),
});

const DEFAULT_COLUMNS = ['name', 'type', 'owner', 'lifecycle', 'criticality', 'disposition'];

export const findElements = defineTool({
  name: 'find_elements',
  description:
    'List elements that match filters, like the Elements page. Fields: name, type, owner, lifecycle, criticality, disposition, plus any recorded attribute by its key (for example supportEndsAt, plannedEnd, annualRunCost). Operators: eq, neq, contains, in, lt, lte, gt, gte, isEmpty, isNotEmpty. Dates compare as YYYY-MM-DD text. Returns id, the requested columns, the true total, and says when the list was cut.',
  schema,
  run: async (ctx, input) => {
    const filters: ReportFilter[] = input.filters.map((f) => ({ field: f.field, operator: f.operator, value: f.value }));
    if (input.type !== undefined) filters.unshift({ field: 'type', operator: 'eq', value: input.type });
    const requested = input.columns ?? DEFAULT_COLUMNS;
    const bad = [...requested, input.sortBy, ...filters.map((f) => f.field)].find((f) => isHelperField(f));
    if (bad !== undefined) return failure(`"${clip(bad, 60)}" is not a field you can use. Use name, type, owner, lifecycle, criticality, disposition or a recorded attribute's key.`);
    const columns = requested.includes('id') ? [...requested] : ['id', ...requested];
    const parsed = parseReportSpec({
      specVersion: REPORT_SPEC_VERSION,
      source: 'elements',
      filters,
      columns,
      sort: [{ field: input.sortBy, direction: input.sortDirection }],
      presentation: { kind: 'table', limit: input.limit },
    });
    if (!parsed.ok) return failure(clip(`That search can't be run: ${parsed.error}`, 300));
    const snapshot = await ctx.snapshot();
    const result = runElementReport(snapshot, parsed.spec);
    return okResult(
      ctx,
      {
        columns: result.columns,
        rows: rowObjects(result),
        ...(result.unknownFields.length > 0 ? { unknownFields: result.unknownFields, note: `No element has a recorded value for: ${result.unknownFields.join(', ')}. A filter on such a field matches nothing.` } : {}),
      },
      result.rowCount,
      result.truncated,
    );
  },
});
