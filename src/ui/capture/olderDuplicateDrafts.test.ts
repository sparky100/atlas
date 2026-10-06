import { describe, expect, it } from 'vitest';
import { olderDuplicateDrafts } from './olderDuplicateDrafts';

describe('olderDuplicateDrafts', () => {
  it('keeps the newest draft of a repeated file and lists the rest, newest first', () => {
    const groups = olderDuplicateDrafts([
      { id: 'a', inputName: 'Plan.pdf', createdAt: '2026-10-01T10:00:00Z' },
      { id: 'b', inputName: 'Plan.pdf', createdAt: '2026-10-03T10:00:00Z' },
      { id: 'c', inputName: 'Plan.pdf', createdAt: '2026-10-02T10:00:00Z' },
    ]);
    expect(groups).toEqual([{ inputName: 'Plan.pdf', newestId: 'b', olderIds: ['c', 'a'] }]);
  });

  it('ignores files with a single draft', () => {
    expect(olderDuplicateDrafts([{ id: 'a', inputName: 'Register.xlsx', createdAt: '2026-10-01T10:00:00Z' }])).toEqual([]);
  });

  it('orders groups by their newest draft and breaks createdAt ties by id', () => {
    const groups = olderDuplicateDrafts([
      { id: 'x2', inputName: 'Old.pdf', createdAt: '2026-09-01T10:00:00Z' },
      { id: 'x1', inputName: 'Old.pdf', createdAt: '2026-09-01T10:00:00Z' },
      { id: 'y1', inputName: 'New.pdf', createdAt: '2026-10-01T10:00:00Z' },
      { id: 'y2', inputName: 'New.pdf', createdAt: '2026-09-15T10:00:00Z' },
    ]);
    expect(groups).toEqual([
      { inputName: 'New.pdf', newestId: 'y1', olderIds: ['y2'] },
      { inputName: 'Old.pdf', newestId: 'x1', olderIds: ['x2'] },
    ]);
  });
});
