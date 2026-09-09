import { describe, expect, it } from 'vitest';
import { ALIAS_TYPE_LABELS, aliasAsFact } from './aliasLabels';
import type { AliasRow } from '../../db/types';

function alias(overrides: Partial<AliasRow> & Pick<AliasRow, 'id' | 'alias_type' | 'alias_value'>): AliasRow {
  return {
    org_id: 'org-1',
    model_id: 'model-1',
    element_id: 'el-1',
    source_id: 'src-1',
    confidence: 1,
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ALIAS_TYPE_LABELS (Sprint U4-1 D1)', () => {
  it('has a human label for every alias_type the database enum allows', () => {
    const types: AliasRow['alias_type'][] = ['name', 'code', 'external_ref', 'source_system_key', 'template_code', 'merged_id'];
    for (const type of types) {
      expect(ALIAS_TYPE_LABELS[type]).toBeTruthy();
    }
  });
});

describe('aliasAsFact (Sprint U4-1 D1)', () => {
  it('reshapes an alias into a FactsRow AttributeRow/FactBadge can render, carrying the alias value and its own provenance through', () => {
    const a = alias({ id: 'alias-1', alias_type: 'template_code', alias_value: '1.1', source_id: 'src-9', confidence: 0.8, created_by: 'user-2', created_at: '2026-02-03T00:00:00Z' });
    const fact = aliasAsFact(a, 'el-1');
    expect(fact).toEqual({
      subject_type: 'element',
      subject_id: 'el-1',
      attribute: 'alias:template_code',
      value: '1.1',
      delta_id: 'alias-1',
      source_id: 'src-9',
      source_ref: null,
      effective_date: null,
      confidence: 0.8,
      asserted_by: 'user-2',
      asserted_at: '2026-02-03T00:00:00Z',
    });
  });
});
