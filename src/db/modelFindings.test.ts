import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../contracts/rows';
import { computeFindings } from './modelFindings';

// Model rule M2: a module carries its own criticality, planned end and vendor support end, so a critical
// module that is ending or past support is exactly as real a finding as a critical system.
const now = new Date('2026-11-26T00:00:00Z');

function element(id: string, type: 'system' | 'container', attributes: Record<string, unknown>, parent: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: type, name: id, parent_id: parent, attributes: attributes as ElementsHeadRow['attributes'], exists_delta_id: `d-${id}` };
}

function flagged(findings: ReadonlyMap<string, readonly ElementsHeadRow[]>, key: string): string[] {
  return (findings.get(key) ?? []).map((e) => e.element_id);
}

describe('computeFindings includes modules (Model rule M2)', () => {
  const platform = element('platform', 'system', { kind: 'platform' });
  const endingModule = element('ending-module', 'container', { criticality: 'critical', plannedEnd: '2027-01-31' }, 'platform');
  const unsupportedModule = element('unsupported-module', 'container', { criticality: 'critical', supportEndsAt: '2026-06-30' }, 'platform');
  const calmModule = element('calm-module', 'container', { criticality: 'critical', plannedEnd: '2031-01-31', supportEndsAt: '2031-01-31' }, 'platform');
  const lowModule = element('low-module', 'container', { criticality: 'low', plannedEnd: '2027-01-31', supportEndsAt: '2026-06-30' }, 'platform');
  const snapshot = { elements: [platform, endingModule, unsupportedModule, calmModule, lowModule], relationships: [] };

  it('flags a critical module that ends within a year with no replacement', () => {
    expect(flagged(computeFindings({ snapshot, facts: [], now }), 'critical-exposed')).toEqual(['ending-module']);
  });

  it('flags a critical module past its vendor support end', () => {
    expect(flagged(computeFindings({ snapshot, facts: [], now }), 'critical-support-end')).toEqual(['unsupported-module']);
  });
});
