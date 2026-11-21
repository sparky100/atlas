import { describe, expect, it } from 'vitest';
import { reviewerAvailability } from './reviewerAvailability';

const ready = { role: 'contributor' as const, status: 'proposed' as const, optionCount: 1, assistantEnabled: true, agentsEnabled: true, keySet: true, ownerNames: ['Simon'] };

describe('decision second opinion availability', () => {
  it('only offers an AI run when the decision has an option and every owner control is enabled', () => {
    expect(reviewerAvailability(ready).available).toBe(true);
    expect(reviewerAvailability({ ...ready, status: 'accepted' }).available).toBe(false);
    expect(reviewerAvailability({ ...ready, optionCount: 0 }).reason).toMatch(/Add an option/);
    expect(reviewerAvailability({ ...ready, role: 'viewer' }).reason).toMatch(/Simon/);
    expect(reviewerAvailability({ ...ready, assistantEnabled: false }).reason).toMatch(/Ask Atlas/);
    expect(reviewerAvailability({ ...ready, agentsEnabled: false }).reason).toMatch(/AI agents/);
    expect(reviewerAvailability({ ...ready, keySet: false }).reason).toMatch(/trial does not include reviewers/);
  });

  it('directs an owner to settings and names an owner to a contributor', () => {
    expect(reviewerAvailability({ ...ready, role: 'owner', keySet: false }).canFix).toBe(true);
    expect(reviewerAvailability({ ...ready, keySet: false }).reason).toMatch(/Simon/);
  });
});
