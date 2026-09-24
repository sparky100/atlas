import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../contracts/rows';
import { buildMatchIndex } from './matchIndex';
import { matchElement } from './match';

function element(overrides: Partial<ElementsHeadRow> = {}): ElementsHeadRow {
  return { element_id: 'el-1', element_type: 'system', name: 'System', parent_id: null, attributes: {}, exists_delta_id: 'd-1', ...overrides };
}

describe('matchElement', () => {
  it('level 1: exact id hit', () => {
    const index = buildMatchIndex([element({ element_id: 'el-1', element_type: 'system' })], []);
    const outcome = matchElement({ name: 'Anything', elementType: 'system', atlasId: 'el-1', context: 'top-level' }, index);
    expect(outcome).toEqual({ level: 'exact_id', elementId: 'el-1', score: 1, similar: [], warnings: [] });
  });

  it('level 1: exact id present but wrong type falls through to level 3', () => {
    const index = buildMatchIndex([element({ element_id: 'el-1', element_type: 'capability' })], []);
    const outcome = matchElement({ name: 'No Match Here', elementType: 'system', atlasId: 'el-1', context: 'top-level' }, index);
    expect(outcome.level).toBe('none');
    expect(outcome.warnings).toContain('ATLAS_ID_NOT_FOUND');
  });

  it('level 1: resolves through a merged_id alias to the survivor', () => {
    const index = buildMatchIndex([element({ element_id: 'el-survivor', element_type: 'system' })], [{ element_id: 'el-survivor', alias_value: 'el-old', alias_type: 'merged_id' }]);
    const outcome = matchElement({ name: 'Anything', elementType: 'system', atlasId: 'el-old', context: 'top-level' }, index);
    expect(outcome).toEqual({ level: 'exact_id', elementId: 'el-survivor', score: 1, similar: [], warnings: ['RESOLVED_THROUGH_MERGED_ID'] });
  });

  it('level 2: alias hit via a source key', () => {
    const index = buildMatchIndex([element({ element_id: 'el-1', element_type: 'system' })], [{ element_id: 'el-1', alias_value: 'SYS-001', alias_type: 'source_system_key' }]);
    const outcome = matchElement({ name: 'Totally different name', elementType: 'system', sourceKeys: ['SYS-001'], context: 'top-level' }, index);
    expect(outcome.level).toBe('alias');
    expect(outcome.elementId).toBe('el-1');
    expect(outcome.aliasType).toBe('source_system_key');
  });

  it('level 2: alias hit via the full normalised name', () => {
    const index = buildMatchIndex([element({ element_id: 'el-1', element_type: 'system' })], [{ element_id: 'el-1', alias_value: 'Legacy CRM', alias_type: 'name' }]);
    const outcome = matchElement({ name: 'Legacy CRM', elementType: 'system', context: 'top-level' }, index);
    expect(outcome.level).toBe('alias');
    expect(outcome.elementId).toBe('el-1');
  });

  it('level 2: an alias to a different element type never matches', () => {
    const index = buildMatchIndex([element({ element_id: 'el-1', element_type: 'capability' })], [{ element_id: 'el-1', alias_value: 'Legacy CRM', alias_type: 'name' }]);
    const outcome = matchElement({ name: 'Legacy CRM', elementType: 'system', context: 'top-level' }, index);
    expect(outcome.level).toBe('none');
  });

  it('level 3: a close-enough name match, system needs no context', () => {
    const index = buildMatchIndex([element({ element_id: 'el-1', element_type: 'system', name: 'Legacy CRM Platform' })], []);
    const outcome = matchElement({ name: 'Legacy CRM Platfrom', elementType: 'system', context: 'top-level' }, index);
    expect(outcome.level).toBe('name_context');
    expect(outcome.elementId).toBe('el-1');
    expect(outcome.score).toBeGreaterThanOrEqual(0.6);
  });

  it('level 3: below 0.5 is not even "similar"', () => {
    const index = buildMatchIndex([element({ element_id: 'el-1', element_type: 'system', name: 'Zzz Unrelated' })], []);
    const outcome = matchElement({ name: 'Legacy CRM Platform', elementType: 'system', context: 'top-level' }, index);
    expect(outcome.level).toBe('none');
    expect(outcome.similar).toEqual([]);
  });

  it('level 3: 0.50-0.60 is "similar" but never auto-matched', () => {
    const index = buildMatchIndex([element({ element_id: 'el-1', element_type: 'system', name: 'Widget Management System' })], []);
    const outcome = matchElement({ name: 'Widget Mgt System', elementType: 'system', context: 'top-level' }, index);
    expect(outcome.level).toBe('none');
    expect(outcome.similar).toEqual([{ elementId: 'el-1', name: 'Widget Management System', score: expect.any(Number) as number }]);
    expect(outcome.similar[0]?.score).toBeGreaterThanOrEqual(0.5);
    expect(outcome.similar[0]?.score).toBeLessThan(0.6);
  });

  it('level 3: two hits within 0.05 of each other are flagged ambiguous', () => {
    const index = buildMatchIndex(
      [element({ element_id: 'el-1', element_type: 'system', name: 'Northgate Payroll' }), element({ element_id: 'el-2', element_type: 'system', name: 'Northgate Payrol Systm' })],
      [],
    );
    const outcome = matchElement({ name: 'Northgate Payroll System', elementType: 'system', context: 'top-level' }, index);
    expect(outcome.level).toBe('name_context');
    expect(outcome.ambiguous).toBeDefined();
    expect(outcome.ambiguous?.length).toBeGreaterThanOrEqual(2);
  });

  it('level 3: context (same parent) is required for a container match', () => {
    const parentA = element({ element_id: 'sys-a', element_type: 'system' });
    const parentB = element({ element_id: 'sys-b', element_type: 'system' });
    const containerUnderA = element({ element_id: 'c-1', element_type: 'container', name: 'Billing Module', parent_id: 'sys-a' });
    const index = buildMatchIndex([parentA, parentB, containerUnderA], []);

    const matchedUnderSameParent = matchElement({ name: 'Billing Module', elementType: 'container', context: 'sys-a' }, index);
    expect(matchedUnderSameParent.level).toBe('name_context');

    const notMatchedUnderDifferentParent = matchElement({ name: 'Billing Module', elementType: 'container', context: 'sys-b' }, index);
    expect(notMatchedUnderDifferentParent.level).toBe('none');
  });

  it('cross-type fallback: a system-typed candidate with no system match falls back to a real container of the same name (ESCOMS: extracted as a system, actually a container of a platform)', () => {
    const platform = element({ element_id: 'sys-1', element_type: 'system', name: 'Salesforce' });
    const escoms = element({ element_id: 'c-1', element_type: 'container', name: 'ESCOMS', parent_id: 'sys-1' });
    const index = buildMatchIndex([platform, escoms], []);

    // No parent was resolved (the document never said "ESCOMS is a module of
    // Salesforce" in so many words) — `context` is unconditionally top-level
    // for a `system`-typed candidate, same as every other system match.
    const outcome = matchElement({ name: 'ESCOMS', elementType: 'system', context: 'top-level' }, index);
    expect(outcome.level).toBe('name_context');
    expect(outcome.elementId).toBe('c-1');
    expect(outcome.warnings).toContain('MATCHED_CROSS_TYPE');
  });

  it('cross-type fallback: the reverse direction — a container-typed candidate falls back to a real top-level system', () => {
    const system = element({ element_id: 'sys-1', element_type: 'system', name: 'Payroll Gateway' });
    const index = buildMatchIndex([system], []);

    const outcome = matchElement({ name: 'Payroll Gateway', elementType: 'container', context: 'top-level' }, index);
    expect(outcome.level).toBe('name_context');
    expect(outcome.elementId).toBe('sys-1');
    expect(outcome.warnings).toContain('MATCHED_CROSS_TYPE');
  });

  it('cross-type fallback: never consulted when the primary pool already has a hit', () => {
    const sameNameSystem = element({ element_id: 'sys-1', element_type: 'system', name: 'Shared Name' });
    const sameNameContainer = element({ element_id: 'c-1', element_type: 'container', name: 'Shared Name', parent_id: 'sys-1' });
    const index = buildMatchIndex([sameNameSystem, sameNameContainer], []);

    const outcome = matchElement({ name: 'Shared Name', elementType: 'system', context: 'top-level' }, index);
    expect(outcome.elementId).toBe('sys-1');
    expect(outcome.warnings).not.toContain('MATCHED_CROSS_TYPE');
  });

  it('cross-type fallback: capability/actor never fall back to anything, even with a same-named element of another type', () => {
    const system = element({ element_id: 'sys-1', element_type: 'system', name: 'Finance' });
    const index = buildMatchIndex([system], []);

    const outcome = matchElement({ name: 'Finance', elementType: 'capability', context: 'top-level' }, index);
    expect(outcome.level).toBe('none');
  });

  it('level 3: a top-level capability only matches another top-level capability', () => {
    const parentCap = element({ element_id: 'cap-parent', element_type: 'capability' });
    const topLevelCap = element({ element_id: 'cap-1', element_type: 'capability', name: 'Finance', parent_id: null });
    const nestedCap = element({ element_id: 'cap-2', element_type: 'capability', name: 'Finance', parent_id: 'cap-parent' });
    const index = buildMatchIndex([parentCap, topLevelCap, nestedCap], []);

    const outcome = matchElement({ name: 'Finance', elementType: 'capability', context: 'top-level' }, index);
    expect(outcome.elementId).toBe('cap-1');
  });
});
