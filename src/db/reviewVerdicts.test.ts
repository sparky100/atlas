import { describe, expect, it } from 'vitest';
import { toReviewerWire } from './reviewVerdicts';

describe('toReviewerWire (F3a)', () => {
  it('maps the camelCase ReviewerInput shape to the snake_case RPC wire shape, preserving order', () => {
    expect(
      toReviewerWire([
        { userId: 'u-1', required: true },
        { userId: 'u-2', required: false },
      ]),
    ).toEqual([
      { user_id: 'u-1', required: true },
      { user_id: 'u-2', required: false },
    ]);
  });

  it('returns an empty array for no reviewers', () => {
    expect(toReviewerWire([])).toEqual([]);
  });
});
