import { describe, expect, it } from 'vitest';
import type { FactsRow } from '../contracts/rows';
import { factsWithoutCost, snapshotWithoutCost } from './runCostExclusion';
import { callTool } from './index';
import { atlasVocabularyForAi } from './vocabularyForAi';
import { element, estateContext, estateSnapshot } from './fixtures/estateSnapshot';

describe('run cost exclusion', () => {
  it('removes annualRunCost from every element and keeps other attributes', () => {
    const snap = estateSnapshot({ elements: [element(70, 'system', 'Costly', { annualRunCost: '1m_5m', criticality: 'high' })] });
    const cleaned = snapshotWithoutCost(snap);
    const costly = cleaned.elements.find((e) => e.name === 'Costly');
    expect(JSON.stringify(costly)).not.toContain('annualRunCost');
    expect(JSON.stringify(costly)).toContain('criticality');
    expect(JSON.stringify(snap)).toContain('annualRunCost');
  });

  it('drops cost facts and keeps the rest', () => {
    const fact = (attribute: string): FactsRow => ({ subject_type: 'element', subject_id: '00000000-0000-4000-8000-000000000001', attribute, value: 'x', delta_id: '00000000-0000-4000-8000-000000000002', source_id: '00000000-0000-4000-8000-000000000003', source_ref: null, effective_date: null, confidence: 1, asserted_by: '00000000-0000-4000-8000-000000000004', asserted_at: '2026-01-01T00:00:00Z' });
    expect(factsWithoutCost([fact('annualRunCost'), fact('criticality')]).map((f) => f.attribute)).toEqual(['criticality']);
  });

  it('portfolio_signals refuses when run cost is excluded', async () => {
    const ctx = { ...estateContext(), runCost: 'exclude' as const };
    const result = await callTool(ctx, 'portfolio_signals', {});
    expect(result.ok).toBe(false);
  });

  it('the vocabulary given to the model does not mention run cost bands when excluded', () => {
    expect(atlasVocabularyForAi({ runCost: 'exclude' })).not.toMatch(/annualRunCost/);
  });
});
