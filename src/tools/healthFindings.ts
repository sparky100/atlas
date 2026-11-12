/**
 * `list_health_findings`: the same named checks the Elements page's Finding
 * filter and the architect door's Health findings panel use
 * (`src/db/healthFindings.ts`), run over the snapshot. With no `finding` it
 * returns every check's count; with one it returns the elements that check
 * flagged, so "which critical systems have no business owner" is answered by
 * the product's own definition, not a new one.
 */
import { z } from 'zod';
import { FINDING_FILTER_OPTIONS } from '../db/elementBrowse';
import { computeFindings } from '../db/modelFindings';
import { DEFAULT_TOOL_ROWS, MAX_TOOL_ROWS } from './limits';
import { defineTool, elementRef, indexSnapshot, okResult } from './toolKit';


const FINDINGS = FINDING_FILTER_OPTIONS.filter((o) => o.value !== '');
const KEYS = FINDINGS.map((o) => o.value) as [string, ...string[]];

const schema = z.strictObject({
  finding: z.enum(KEYS).optional().describe('One finding key from the list this tool returns when called with no finding.'),
  limit: z.number().int().min(1).max(MAX_TOOL_ROWS).default(DEFAULT_TOOL_ROWS),
});

export const listHealthFindings = defineTool({
  name: 'list_health_findings',
  description: `The model's data-quality checks (the same ones as the Health findings panel). With no "finding", returns every check with its label and count. With a "finding" key (one of: ${KEYS.join(', ')}), returns the elements that check flagged.`,
  schema,
  run: async (ctx, input) => {
    const snapshot = await ctx.snapshot();
    const findings = computeFindings({ snapshot, facts: await ctx.allFacts(), retiredByOpenChanges: await ctx.retiredByOpenChanges(), now: ctx.now(), staleAfterMonths: await ctx.staleAfterMonths() });
    if (input.finding === undefined) {
      return okResult(ctx, { findings: FINDINGS.map((o) => ({ finding: o.value, label: o.label, count: findings.get(o.value)?.length ?? 0 })) });
    }
    const index = indexSnapshot(snapshot);
    const flagged = findings.get(input.finding) ?? [];
    const shown = flagged.slice(0, input.limit);
    const label = FINDINGS.find((o) => o.value === input.finding)?.label ?? input.finding;
    return okResult(ctx, { finding: input.finding, label, elements: shown.map((e) => elementRef(index, e)) }, flagged.length, flagged.length > shown.length);
  },
});
