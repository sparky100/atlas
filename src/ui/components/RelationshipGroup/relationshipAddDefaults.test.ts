import { describe, expect, it } from 'vitest';
import type { RelationshipType } from '../../../contracts/delta';
import { RELATIONSHIP_TYPES } from '../../../contracts/delta';
import { defaultAttributesForPlainPick, hasExactNameMatch, newOwnerAttributes } from './relationshipAddDefaults';

describe('defaultAttributesForPlainPick (Sprint U4-1 B5 bugfix, extended by Prompt 7k item 2)', () => {
  it('supports gets an explicit { role: "secondary" } override — the first-link-or-inbound case B4 never prompts for', () => {
    expect(defaultAttributesForPlainPick('supports')).toEqual({ role: 'secondary' });
  });

  it('owns targeting a capability gets an explicit { role: "business" } override — the plain-pick default item 1 names', () => {
    expect(defaultAttributesForPlainPick('owns', 'capability')).toEqual({ role: 'business' });
  });

  it("owns targeting a system gets undefined — RelationshipAdd's own staged role prompt should have already intercepted it; useRelationshipCreate's own { role: 'business' } bare fallback applies if it somehow didn't", () => {
    expect(defaultAttributesForPlainPick('owns', 'system')).toBeUndefined();
  });

  it('owns targeting a container gets undefined too, same as a system target — a module gets the same staged role prompt', () => {
    expect(defaultAttributesForPlainPick('owns', 'container')).toBeUndefined();
  });

  it('every other relationship type gets undefined — this function never invents attributes for a type it does not know needs one', () => {
    const others: RelationshipType[] = RELATIONSHIP_TYPES.filter((t) => t !== 'supports' && t !== 'owns');
    for (const type of others) {
      expect(defaultAttributesForPlainPick(type)).toBeUndefined();
    }
  });
});

describe('inline new owner', () => {
  it('an organisation is always outside ours', () => {
    expect(newOwnerAttributes('organisation', false)).toEqual({ subtype: 'organisation', isExternal: true });
  });
  it('a team or person follows the tick', () => {
    expect(newOwnerAttributes('team', false)).toEqual({ subtype: 'team', isExternal: false });
    expect(newOwnerAttributes('person', true)).toEqual({ subtype: 'person', isExternal: true });
  });
  it('matches an existing name ignoring case and spaces', () => {
    expect(hasExactNameMatch(' electralink ', ['Electralink'])).toBe(true);
    expect(hasExactNameMatch('Electra', ['Electralink'])).toBe(false);
  });
});
