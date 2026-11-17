/**
 * `portfolio_signals`: the Portfolio page's rows and signals (costly with poor
 * fit, costly overlap, justified, and so on), built by the same
 * `buildPortfolioRows` the page uses, so a question about "the expensive
 * systems that fit badly" gets the page's own answer.
 */
import { z } from 'zod';
import { buildPortfolioRows, type PortfolioRow } from '../engine/portfolio/buildPortfolioRows';
import { PORTFOLIO_SIGNAL_KEYS, PORTFOLIO_SIGNAL_LABEL } from '../engine/portfolio/portfolioSignalLabels';
import { clip, DEFAULT_TOOL_ROWS, MAX_TOOL_ROWS } from './limits';
import { defineTool, okResult } from './toolKit';
import type { ModelSnapshot } from './types';

export function portfolioRowsOf(snapshot: ModelSnapshot, now: Date): PortfolioRow[] {
  const of = (type: string) => snapshot.elements.filter((e) => e.element_type === type);
  return buildPortfolioRows({
    systems: of('system'),
    containers: of('container'),
    capabilities: of('capability'),
    actors: of('actor'),
    supportsEdges: snapshot.relationships.filter((r) => r.relationship_type === 'supports'),
    ownsEdges: snapshot.relationships.filter((r) => r.relationship_type === 'owns'),
    now,
  }).rows;
}

const schema = z.strictObject({
  signal: z.enum(PORTFOLIO_SIGNAL_KEYS as unknown as [string, ...string[]]).optional(),
  includePlannedAndRetired: z.boolean().default(false),
  limit: z.number().int().min(1).max(MAX_TOOL_ROWS).default(DEFAULT_TOOL_ROWS),
});

export const portfolioSignals = defineTool({
  name: 'portfolio_signals',
  description: `The Portfolio view over systems and modules: run cost band, fit, criticality, planned action, whether lifecycle exposure is known, capabilities served, business owner, and the signals that fire. Like the Portfolio page it covers today's live systems only; planned and retired ones are left out unless "includePlannedAndRetired" is true. With no "signal", returns how many rows each signal fires on. With a "signal" (one of: ${PORTFOLIO_SIGNAL_KEYS.join(', ')}), returns the rows it fires on.`,
  schema,
  run: async (ctx, input) => {
    const everyRow = portfolioRowsOf(await ctx.snapshot(), ctx.now());
    const rows = input.includePlannedAndRetired ? everyRow : everyRow.filter((r) => r.lifecycleState === 'active');
    const leftOut = everyRow.length - rows.length;
    if (input.signal === undefined) {
      return okResult(ctx, {
        rows: rows.length,
        ...(leftOut > 0 ? { leftOutPlannedOrRetired: leftOut } : {}),
        signals: PORTFOLIO_SIGNAL_KEYS.map((key) => ({ signal: key, label: PORTFOLIO_SIGNAL_LABEL[key], count: rows.filter((r) => r.signals.some((s) => s.key === key)).length })),
      });
    }
    const matching = rows.filter((r) => r.signals.some((s) => s.key === input.signal));
    const shown = matching.slice(0, input.limit).map((r) => ({
      id: r.element.element_id,
      type: r.element.element_type,
      name: clip(r.name, 200),
      cost: r.cost,
      fit: r.fit,
      criticality: r.criticality,
      plannedAction: r.disposition,
      lifecycleState: r.lifecycleState,
      lifecycleExposed: r.lifecycleExposed,
      capabilities: r.capabilities.slice(0, 10).map((c) => ({ id: c.capabilityId, name: clip(c.capabilityName, 200) })),
      businessOwner: r.businessOwner ? { id: r.businessOwner.element_id, name: clip(r.businessOwner.name, 200) } : null,
      signals: r.signals.map((s) => ({ signal: s.key, reason: clip(s.reason, 300) })),
      missingInputs: r.missingInputs,
    }));
    return okResult(ctx, { signal: input.signal, label: PORTFOLIO_SIGNAL_LABEL[input.signal as keyof typeof PORTFOLIO_SIGNAL_LABEL], rows: shown }, matching.length, matching.length > shown.length);
  },
});
