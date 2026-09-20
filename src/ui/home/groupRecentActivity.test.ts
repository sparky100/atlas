import { describe, expect, it } from 'vitest';
import type { CommitRow } from '../../contracts/rows';
import type { RecentCommitRow } from './useArchitectHomeInsights';
import { selectRecentActivity } from './groupRecentActivity';

function commit(id: string, title: string, authorId: string): CommitRow {
  return {
    id,
    org_id: 'org-1',
    model_id: 'model-1',
    branch_id: 'main',
    parent_commit_id: null,
    merged_branch_head_commit_id: null,
    kind: 'manual',
    title,
    body: null,
    author_id: authorId,
    head_hash: null,
    depth: 0,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function row(id: string, title: string, authorId: string, isOwn: boolean, subjects: { elementId: string; name: string }[] = []): RecentCommitRow {
  return { commit: commit(id, title, authorId), authorDisplay: authorId, subjects, isOwn };
}

describe('selectRecentActivity', () => {
  it('collapses consecutive commits touching the same one subject into one group', () => {
    const rows = [
      row('c3', 'edit 3', 'u1', true, [{ elementId: 'dynamics', name: 'Dynamics' }]),
      row('c2', 'edit 2', 'u1', true, [{ elementId: 'dynamics', name: 'Dynamics' }]),
      row('c1', 'edit 1', 'u1', true, [{ elementId: 'dynamics', name: 'Dynamics' }]),
    ];
    const { shown } = selectRecentActivity(rows, 5);
    expect(shown).toHaveLength(1);
    const [group] = shown;
    expect(group?.count).toBe(3);
    expect(group?.latest.commit.id).toBe('c3');
    expect(group?.subject).toEqual({ elementId: 'dynamics', name: 'Dynamics' });
  });

  it('never merges across an unrelated commit in between, even to the same subject', () => {
    const rows = [
      row('c3', 'edit dynamics again', 'u1', true, [{ elementId: 'dynamics', name: 'Dynamics' }]),
      row('c2', 'someone else edits billing', 'u2', false, [{ elementId: 'billing', name: 'Billing' }]),
      row('c1', 'edit dynamics', 'u1', true, [{ elementId: 'dynamics', name: 'Dynamics' }]),
    ];
    const { shown } = selectRecentActivity(rows, 5);
    expect(shown.map((g) => g.count)).toEqual([1, 1, 1]);
  });

  it('never collapses a commit touching zero or several subjects', () => {
    const rows = [
      row('c2', 'multi-subject commit', 'u1', true, [
        { elementId: 'a', name: 'A' },
        { elementId: 'b', name: 'B' },
      ]),
      row('c1', 'multi-subject commit 2', 'u1', true, [
        { elementId: 'a', name: 'A' },
        { elementId: 'b', name: 'B' },
      ]),
    ];
    const { shown } = selectRecentActivity(rows, 5);
    expect(shown).toHaveLength(2);
    expect(shown.every((g) => g.subject === null && g.count === 1)).toBe(true);
  });

  it('caps at the given limit and reports the rest', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`c${String(i)}`, `edit ${String(i)}`, 'u1', false, [{ elementId: `el${String(i)}`, name: `El ${String(i)}` }]));
    const { shown, rest } = selectRecentActivity(rows, 5);
    expect(shown).toHaveLength(5);
    expect(rest).toHaveLength(3);
  });

  it("prefers others' activity when trimming to the limit", () => {
    // Newest-first: two of the viewer's own edits, then three others'.
    const rows = [
      row('c5', 'my edit 2', 'me', true, [{ elementId: 'x', name: 'X' }]),
      row('c4', 'my edit 1', 'me', true, [{ elementId: 'y', name: 'Y' }]),
      row('c3', "alice's edit", 'alice', false, [{ elementId: 'z', name: 'Z' }]),
      row('c2', "bob's edit", 'bob', false, [{ elementId: 'w', name: 'W' }]),
      row('c1', "carol's edit", 'carol', false, [{ elementId: 'v', name: 'V' }]),
    ];
    const { shown } = selectRecentActivity(rows, 3);
    // All three others' edits are kept; both of the viewer's own are dropped.
    expect(shown.map((g) => g.latest.commit.id).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it("still fills remaining slots with the viewer's own activity once every other group is already shown", () => {
    const rows = [
      row('c3', 'my edit', 'me', true, [{ elementId: 'x', name: 'X' }]),
      row('c2', 'my other edit', 'me', true, [{ elementId: 'y', name: 'Y' }]),
      row('c1', "alice's edit", 'alice', false, [{ elementId: 'z', name: 'Z' }]),
    ];
    const { shown } = selectRecentActivity(rows, 5);
    expect(shown).toHaveLength(3);
  });

  it('keeps the selected groups in their original newest-first order', () => {
    const rows = [
      row('c3', 'my edit', 'me', true, [{ elementId: 'x', name: 'X' }]),
      row('c2', "alice's edit", 'alice', false, [{ elementId: 'z', name: 'Z' }]),
      row('c1', 'my other edit', 'me', true, [{ elementId: 'y', name: 'Y' }]),
    ];
    const { shown } = selectRecentActivity(rows, 5);
    expect(shown.map((g) => g.latest.commit.id)).toEqual(['c3', 'c2', 'c1']);
  });
});
