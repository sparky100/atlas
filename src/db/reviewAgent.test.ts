import { describe, expect, it } from 'vitest';
import { interpretReviewerReply } from './reviewAgent';

const done = { status: 'done', inputHash: 'hash', runId: 'run', inputTokens: 10, outputTokens: 5, notes: [{ note: 'The source is unconfirmed.', question: 'Who checks it?', basedOn: { kind: 'element', label: 'CRM', elementId: 'id' } }] };

describe('reviewer response to the decision page', () => {
  it('keeps grounded questions and rejects incomplete or malformed replies', () => {
    expect(interpretReviewerReply(done).notes[0]?.basedOn.label).toBe('CRM');
    expect(() => interpretReviewerReply({ status: 'incomplete', message: 'The reviewer was cut short.' })).toThrow(/cut short/);
    expect(() => interpretReviewerReply({ ...done, notes: [{ note: 'Bad', question: 'Why?', basedOn: { kind: 'unknown', label: 'CRM' } }] })).toThrow(/unexpected form/);
  });
});
