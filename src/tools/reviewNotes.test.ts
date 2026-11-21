import { describe, expect, it } from 'vitest';
import { parseReviewNotes } from './reviewNotes';

const ID = '00000000-0000-4000-8000-000000000001';

function answer(notes: unknown[]): string {
  return JSON.stringify({ notes });
}

describe('parseReviewNotes', () => {
  it('parses a plain note, an option-based note and a record-based note', () => {
    const result = parseReviewNotes(
      answer([
        { note: 'The evidence is thin.', basedOn: { kind: 'none' }, question: 'What would change your mind?' },
        { note: 'Replace is not rated.', basedOn: { kind: 'option', branchId: ID, label: 'Replace' }, question: 'Has anyone rated it?' },
        { note: 'Billing is affected.', basedOn: { kind: 'element', elementId: ID, label: 'Billing' }, question: 'Who has checked the data?' },
      ]),
    );
    expect(result.problems).toEqual([]);
    expect(result.notes).toHaveLength(3);
    expect(result.notes[0]?.basedOn.kind).toBe('none');
    expect(result.notes[1]?.basedOn).toMatchObject({ kind: 'option', branchId: ID, label: 'Replace' });
    expect(result.notes[2]?.basedOn).toMatchObject({ kind: 'element', elementId: ID, label: 'Billing' });
  });

  it('drops a verdict, a score-shaped note and a note with no question, and counts them', () => {
    const result = parseReviewNotes(
      answer([
        { note: 'This is compliant.', basedOn: { kind: 'none' }, question: 'Is it?' },
        { note: 'Everything is fine.', basedOn: { kind: 'none' }, question: 'Is it approved?' },
        { note: 'No question here.', basedOn: { kind: 'none' } },
      ]),
    );
    expect(result.notes).toEqual([]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('3 notes');
  });

  it('caps at five notes', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ note: `Note ${String(i)}`, basedOn: { kind: 'none' }, question: `Question ${String(i)}?` }));
    expect(parseReviewNotes(answer(many)).notes).toHaveLength(5);
  });

  it('reads an unrecognised basis as "not tied to a record" rather than inventing one', () => {
    const result = parseReviewNotes(answer([{ note: 'A fact.', basedOn: { kind: 'option', branchId: 'not-a-uuid', label: 'X' }, question: 'Why?' }]));
    expect(result.notes[0]?.basedOn).toEqual({ kind: 'none', label: 'Not tied to a record' });
  });

  it('reports unusable output instead of an empty, reassuring list', () => {
    expect(parseReviewNotes('not json').problems[0]).toContain('did not return notes');
  });
});
