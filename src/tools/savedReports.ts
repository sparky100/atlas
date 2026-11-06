import { z } from 'zod';
import { parseReportSpec } from '../contracts/reportSpec';
import { clip, MAX_TOOL_ROWS } from './limits';
import { runElementReport, rowObjects } from './reportRows';
import { defineTool, failure, okResult, uuidInput } from './toolKit';

export const listSavedReports = defineTool({
  name: 'list_saved_reports',
  description: 'The saved reports this person can see (their own and the ones shared with the organisation): id, name, description and what each is about. Use run_saved_report to run one.',
  schema: z.strictObject({}),
  run: async (ctx) => {
    const reports = await ctx.savedReports();
    const shown = reports.slice(0, MAX_TOOL_ROWS).map((r) => {
      const parsed = parseReportSpec(r.spec);
      return { id: r.id, name: clip(r.name, 200), description: clip(r.description, 300), about: parsed.ok ? parsed.spec.source : 'unreadable' };
    });
    return okResult(ctx, { reports: shown }, reports.length, reports.length > shown.length);
  },
});

export const runSavedReport = defineTool({
  name: 'run_saved_report',
  description: 'Run one saved report over the model as it is now and return its rows (or its counts, if it groups). Only reports about elements can be run here for now.',
  schema: z.strictObject({ reportId: uuidInput }),
  run: async (ctx, input) => {
    const report = (await ctx.savedReports()).find((r) => r.id === input.reportId);
    if (!report) return failure('No saved report with that id that you can see. Use list_saved_reports.');
    const parsed = parseReportSpec(report.spec);
    if (!parsed.ok) return failure(clip(`That report's definition can't be read: ${parsed.error}`, 300));
    if (parsed.spec.source !== 'elements') return failure(`That report is about "${parsed.spec.source}", which Ask Atlas can't run yet. Only reports about elements can be run here.`);
    const spec = parsed.spec;
    const limited =
      spec.presentation.kind === 'table' ? { ...spec, presentation: { kind: 'table' as const, limit: Math.min(spec.presentation.limit ?? MAX_TOOL_ROWS, MAX_TOOL_ROWS) } } : spec;
    const result = runElementReport(await ctx.snapshot(), limited);
    return okResult(
      ctx,
      {
        report: { id: report.id, name: clip(report.name, 200) },
        columns: result.columns,
        rows: rowObjects(result),
        groups: result.groups.slice(0, MAX_TOOL_ROWS).map((g) => ({ value: typeof g.value === 'string' ? clip(g.value, 200) : g.value, count: g.count })),
        groupsTruncated: result.groups.length > MAX_TOOL_ROWS,
        ...(result.unknownFields.length > 0 ? { unknownFields: result.unknownFields } : {}),
      },
      result.rowCount,
      result.truncated,
    );
  },
});
