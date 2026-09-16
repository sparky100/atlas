import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import { elementBreadcrumbSegments } from './elementBreadcrumbSegments';

function element(id: string, type: ElementsHeadRow['element_type'], name: string, parentId: string | null): ElementsHeadRow {
  return { element_id: id, element_type: type, name, parent_id: parentId, attributes: {}, exists_delta_id: `d-${id}` };
}

describe('elementBreadcrumbSegments', () => {
  it('gives a capability one segment, linking to the capability map', () => {
    const cap = element('cap1', 'capability', 'Housing', null);
    expect(elementBreadcrumbSegments(cap, null, 'acme', 'model1', 'ref=main')).toEqual([{ label: 'Housing', href: '/o/acme/m/model1/capability-map?ref=main' }]);
  });

  it('gives a system one segment, linking to its own Context view', () => {
    const sys = element('sys1', 'system', 'CRM', null);
    expect(elementBreadcrumbSegments(sys, null, 'acme', 'model1', 'ref=main')).toEqual([{ label: 'CRM', href: '/o/acme/m/model1/context/sys1?ref=main' }]);
  });

  it('gives a container two segments: its parent system (Context), then its own Context view', () => {
    const sys = element('sys1', 'system', 'CRM', null);
    const container = element('c1', 'container', 'API', 'sys1');
    expect(elementBreadcrumbSegments(container, sys, 'acme', 'model1', 'ref=main')).toEqual([
      { label: 'CRM', href: '/o/acme/m/model1/context/sys1?ref=main' },
      { label: 'API', href: '/o/acme/m/model1/context/c1?ref=main' },
    ]);
  });

  it('omits the parent segment for a container whose parent did not resolve, but still gives itself a segment', () => {
    const container = element('c1', 'container', 'API', 'sys1');
    expect(elementBreadcrumbSegments(container, null, 'acme', 'model1', 'ref=main')).toEqual([{ label: 'API', href: '/o/acme/m/model1/context/c1?ref=main' }]);
  });

  it('gives an actor no segments at all', () => {
    const actor = element('a1', 'actor', 'Platform Team', null);
    expect(elementBreadcrumbSegments(actor, null, 'acme', 'model1', 'ref=main')).toEqual([]);
  });
});
