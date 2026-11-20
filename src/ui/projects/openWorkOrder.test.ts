import { describe, expect, it } from 'vitest';
import { orderOpenWork } from './openWorkOrder';

const d = (id: string) => ({ id });
describe('orderOpenWork', () => {
  it('puts each decision first with its own options under it', () => {
    const r = orderOpenWork([d('d1'), d('d2')], [d('c1'), d('c2'), d('c3')], [
      { decisionId: 'd1', branchId: 'c1' },
      { decisionId: 'd2', branchId: 'c3' },
      { decisionId: 'd1', branchId: 'c2' },
    ]);
    expect(r.groups.map((g) => [g.decision.id, g.changes.map((c) => c.id)])).toEqual([
      ['d1', ['c1', 'c2']],
      ['d2', ['c3']],
    ]);
    expect(r.standalone).toEqual([]);
  });
  it('lists a change with no open decision on its own', () => {
    const r = orderOpenWork([d('d1')], [d('c1'), d('c2')], [{ decisionId: 'gone', branchId: 'c1' }]);
    expect(r.standalone.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});
