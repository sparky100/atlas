import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { DecisionLinkRow } from '../../db/types';
import {
  directlyLinkedCapabilities,
  linkedSupportingSystemIds,
  mergeCapabilityConcerns,
  supportedCapabilityIds,
} from './capabilityConcerns';

const element = (id: string, type: ElementsHeadRow['element_type'], name: string): ElementsHeadRow => ({
  element_id: id,
  element_type: type,
  name,
  parent_id: null,
  attributes: {},
  exists_delta_id: 'd',
});

const link = (type: DecisionLinkRow['linked_type'], id: string): DecisionLinkRow => ({
  decision_id: 'decision',
  linked_type: type,
  linked_id: id,
  created_by: 'user',
  created_at: '2026-11-23T00:00:00Z',
});

const supports = (from: string, to: string): RelationshipsHeadRow => ({
  relationship_id: `${from}-${to}`,
  relationship_type: 'supports',
  from_element_id: from,
  to_element_id: to,
  attributes: {},
  exists_delta_id: 'd',
});

const elements = new Map([
  ['cap-direct', element('cap-direct', 'capability', 'Utility billing')],
  ['sys-1', element('sys-1', 'system', 'SAP')],
  ['actor-1', element('actor-1', 'actor', 'Finance')],
]);

describe('directlyLinkedCapabilities', () => {
  it('keeps only capability links, in link order', () => {
    const links = [link('element', 'cap-direct'), link('element', 'sys-1'), link('element', 'actor-1')];
    expect(directlyLinkedCapabilities(links, elements)).toEqual([{ id: 'cap-direct', name: 'Utility billing' }]);
  });

  it('ignores branch and relationship links', () => {
    expect(directlyLinkedCapabilities([link('branch', 'cap-direct'), link('relationship', 'cap-direct')], elements)).toEqual([]);
  });
});

describe('linkedSupportingSystemIds', () => {
  it('keeps systems, containers and modules, not actors or capabilities', () => {
    const links = [link('element', 'sys-1'), link('element', 'cap-direct'), link('element', 'actor-1')];
    expect(linkedSupportingSystemIds(links, elements)).toEqual(['sys-1']);
  });
});

describe('supportedCapabilityIds', () => {
  it('reads supports edges from the linked systems only, deduplicated', () => {
    const edges = [supports('sys-1', 'cap-a'), supports('other', 'cap-b'), supports('sys-1', 'cap-a'), supports('sys-1', 'cap-c')];
    expect(supportedCapabilityIds(['sys-1'], edges)).toEqual(['cap-a', 'cap-c']);
  });

  it('is empty when no system is linked', () => {
    expect(supportedCapabilityIds([], [supports('sys-1', 'cap-a')])).toEqual([]);
  });
});

describe('mergeCapabilityConcerns', () => {
  it('keeps direct capabilities first and removes duplicates and unnamed rows', () => {
    expect(
      mergeCapabilityConcerns(
        [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
        [{ id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma' }, { id: 'd', name: '  ' }],
      ),
    ).toEqual([
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
      { id: 'c', name: 'Gamma' },
    ]);
  });
});
