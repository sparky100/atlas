import { describe, expect, it } from 'vitest';
import type { BeforeAfterColumn } from './projectBeforeAfterModel';
import { DIAGRAM_NODE_HEIGHT, layoutProjectDiagram } from './projectDiagramLayout';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const CAP = { id: id(1), name: 'Housing Repairs' };

function column(): BeforeAfterColumn {
  return {
    changeId: null,
    title: 'Today',
    systems: [
      {
        id: id(10),
        name: 'Repairs Hub',
        mark: 'same',
        connections: [
          { key: 'a|sends ⇢', appId: id(20), appName: 'Billing', isExternal: false, label: 'sends ⇢', mark: 'same' },
          { key: 'b|reads ⇠', appId: id(21), appName: 'Postcode API', isExternal: true, label: 'reads ⇠', mark: 'new' },
        ],
      },
      {
        id: id(11),
        name: 'Old CRM',
        mark: 'ends',
        connections: [{ key: 'a|sends ⇢', appId: id(20), appName: 'Billing', isExternal: false, label: 'sends ⇢', mark: 'ends' }],
      },
    ],
  };
}

describe('layoutProjectDiagram', () => {
  it('lays out the capability, its systems and the apps in three bands', () => {
    const layout = layoutProjectDiagram(CAP, column());
    const kinds = (k: string) => layout.nodes.filter((n) => n.kind === k);
    expect(kinds('capability')).toHaveLength(1);
    expect(kinds('system')).toHaveLength(2);
    expect(kinds('app')).toHaveLength(2);
    expect(must(kinds('capability')[0]).x).toBeLessThan(must(kinds('system')[0]).x);
    expect(must(kinds('system')[0]).x).toBeLessThan(must(kinds('app')[0]).x);
  });

  it('draws a shared app once, with a line from each system into it', () => {
    const layout = layoutProjectDiagram(CAP, column());
    const billing = layout.nodes.filter((n) => n.name === 'Billing');
    expect(billing).toHaveLength(1);
    expect(layout.edges.filter((e) => e.toKey === must(billing[0]).key)).toHaveLength(2);
  });

  it('carries every mark as words, not colour alone', () => {
    const layout = layoutProjectDiagram(CAP, column());
    expect(must(layout.nodes.find((n) => n.name === 'Old CRM')).caption).toBe('Ends');
    expect(must(layout.nodes.find((n) => n.name === 'Postcode API')).caption).toBe('New · External');
    expect(must(layout.nodes.find((n) => n.name === 'Repairs Hub')).caption).toBeNull();
  });

  it('keeps no two nodes in a band overlapping and every node inside the canvas', () => {
    const layout = layoutProjectDiagram(CAP, column());
    for (const a of layout.nodes) {
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.y + a.height).toBeLessThanOrEqual(layout.height + 0.001);
      expect(a.x + a.width).toBeLessThanOrEqual(layout.width);
      for (const b of layout.nodes) {
        if (a === b || a.x !== b.x) continue;
        expect(a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
      }
    }
  });

  it('is deterministic', () => {
    expect(layoutProjectDiagram(CAP, column())).toEqual(layoutProjectDiagram(CAP, column()));
  });

  it('draws just the capability when nothing supports it', () => {
    const layout = layoutProjectDiagram(CAP, { changeId: null, title: 'Today', systems: [] });
    expect(layout.nodes).toHaveLength(1);
    expect(layout.edges).toHaveLength(0);
    expect(layout.height).toBe(DIAGRAM_NODE_HEIGHT);
  });

  it('spreads two lines between the same pair so their labels do not collide', () => {
    const col = column();
    must(col.systems[0]).connections.push({ key: 'a|reads ⇠', appId: id(20), appName: 'Billing', isExternal: false, label: 'reads ⇠', mark: 'same' });
    const layout = layoutProjectDiagram(CAP, col);
    const pair = layout.edges.filter((e) => e.label === 'sends ⇢' || e.label === 'reads ⇠').filter((e) => e.toKey === `app:${id(20)}` && e.fromKey === `system:${id(10)}`);
    expect(pair).toHaveLength(2);
    expect(must(pair[0]).labelY).not.toBe(must(pair[1]).labelY);
  });
});
