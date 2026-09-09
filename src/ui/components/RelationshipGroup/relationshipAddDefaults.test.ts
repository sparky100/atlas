import { describe, expect, it } from 'vitest';
import type { RelationshipType } from '../../../contracts/delta';
import { RELATIONSHIP_TYPES } from '../../../contracts/delta';
import { defaultAttributesForPlainPick } from './relationshipAddDefaults';

describe('defaultAttributesForPlainPick (Sprint U4-1 B5 bugfix)', () => {
  it('supports gets an explicit { role: "secondary" } override — the first-link-or-inbound case B4 never prompts for', () => {
    expect(defaultAttributesForPlainPick('supports')).toEqual({ role: 'secondary' });
  });

  it("owns gets undefined — useRelationshipCreate's own { primary: true } default applies, not a role attribute owns does not have", () => {
    expect(defaultAttributesForPlainPick('owns')).toBeUndefined();
  });

  it('every other relationship type gets undefined — this function never invents attributes for a type it does not know needs one', () => {
    const others: RelationshipType[] = RELATIONSHIP_TYPES.filter((t) => t !== 'supports');
    for (const type of others) {
      expect(defaultAttributesForPlainPick(type)).toBeUndefined();
    }
  });
});
