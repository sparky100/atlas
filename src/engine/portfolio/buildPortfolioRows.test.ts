import { expect, it } from 'vitest';
import type { ElementsHeadRow, Json, RelationshipsHeadRow } from '../../contracts/rows';
import { buildPortfolioRows } from './buildPortfolioRows';

function element(id: string, type: ElementsHeadRow['element_type'], attributes: Json = {}, parentId: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: type, name: id, parent_id: parentId, attributes, exists_delta_id: `d-${id}` };
}

function edge(from: string, to: string, type: RelationshipsHeadRow['relationship_type'], attributes: Json): RelationshipsHeadRow {
  return { relationship_id: `${from}-${to}`, relationship_type: type, from_element_id: from, to_element_id: to, attributes, exists_delta_id: `d-${from}-${to}` };
}

it('preserves fit, owner and overlap evidence for platforms, modules and independent systems', () => {
  const platform = element('Platform', 'system', { annualRunCost: '250k_1m', criticality: 'high' });
  const module = element('Module', 'container', { annualRunCost: '1m_5m' }, 'Platform');
  const rival = element('Rival', 'system', { annualRunCost: '250k_1m' });
  const uncosted = element('Uncosted', 'system');
  const owner = element('Owner', 'actor');
  const technicalOwner = element('Technical owner', 'actor');
  const technicalEdge = edge('Technical owner', 'Platform', 'owns', { role: 'technical' });
  const ownerEdge = edge('Owner', 'Platform', 'owns', { role: 'business' });
  const { rows } = buildPortfolioRows({
    systems: [platform, rival, uncosted],
    containers: [module],
    capabilities: [element('Finance', 'capability'), element('Billing', 'capability')],
    actors: [owner, technicalOwner],
    supportsEdges: [
      edge('Rival', 'Billing', 'supports', { fitForPurpose: 'good' }),
      edge('Platform', 'Finance', 'supports', { fitForPurpose: 'good' }),
      edge('Rival', 'Finance', 'supports', { fitForPurpose: 'good' }),
      edge('Uncosted', 'Finance', 'supports', {}),
      edge('Module', 'Finance', 'supports', { fitForPurpose: 'adequate' }),
      edge('Platform', 'Billing', 'supports', { fitForPurpose: 'poor' }),
    ],
    ownsEdges: [technicalEdge, ownerEdge],
    now: new Date('2026-11-11'),
  });

  const [platformRow, rivalRow, uncostedRow, moduleRow] = rows;
  expect(platformRow?.fit).toBe('poor');
  expect(platformRow?.businessOwner).toEqual(owner);
  expect(platformRow?.ownsEdges).toEqual([technicalEdge, ownerEdge]);
  expect(platformRow?.capabilities.map((link) => link.capabilityName)).toEqual(['Finance', 'Billing']);
  expect(platformRow?.signals.find((signal) => signal.key === 'costly_overlap')?.reason).toContain('Billing, Finance');
  expect(moduleRow?.signals.find((signal) => signal.key === 'costly_overlap')?.reason).toContain('Billing, Finance');
  expect(uncostedRow?.signals.some((signal) => signal.key === 'costly_overlap')).toBe(false);
  expect(rivalRow?.capabilities.find((link) => link.capabilityId === 'Finance')?.otherSupporters).toEqual([
    { topLevelSystemId: 'Platform', name: 'Platform', cost: '1m_5m' },
    { topLevelSystemId: 'Uncosted', name: 'Uncosted', cost: null },
  ]);
  expect(moduleRow?.capabilities[0]?.otherSupporters.map((supporter) => supporter.topLevelSystemId)).toEqual(['Rival', 'Uncosted']);
});
