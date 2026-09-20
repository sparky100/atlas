import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../contracts/rows';
import { buildMatchIndex, type MatchAliasInput } from './matchIndex';

function element(overrides: Partial<ElementsHeadRow> = {}): ElementsHeadRow {
  return { element_id: 'el-1', element_type: 'system', name: 'System', parent_id: null, attributes: {}, exists_delta_id: 'd-1', ...overrides };
}

describe('buildMatchIndex', () => {
  it('groups elements by id and by type', () => {
    const a = element({ element_id: 'el-1', element_type: 'system' });
    const b = element({ element_id: 'el-2', element_type: 'capability' });
    const index = buildMatchIndex([a, b], []);
    expect(index.elements.get('el-1')).toBe(a);
    expect(index.elementsByType.get('system')).toEqual([a]);
    expect(index.elementsByType.get('capability')).toEqual([b]);
  });

  it('indexes ordinary aliases by normalised value, excluding merged_id rows', () => {
    const aliases: MatchAliasInput[] = [
      { element_id: 'el-1', alias_value: 'Legacy CRM', alias_type: 'name' },
      { element_id: 'el-2', alias_value: 'el-1', alias_type: 'merged_id' },
    ];
    const index = buildMatchIndex([], aliases);
    expect(index.aliasByNormalisedValue.get('legacy crm')).toEqual({ elementId: 'el-1', aliasType: 'name' });
    expect(index.aliasByNormalisedValue.has('el-1')).toBe(false);
  });

  it('routes merged_id rows into mergedIdAlias, old id -> survivor', () => {
    const aliases: MatchAliasInput[] = [{ element_id: 'el-survivor', alias_value: 'el-old', alias_type: 'merged_id' }];
    const index = buildMatchIndex([], aliases);
    expect(index.mergedIdAlias.get('el-old')).toBe('el-survivor');
  });
});
