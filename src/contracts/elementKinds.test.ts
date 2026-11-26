import { describe, expect, it } from 'vitest';
import { isSystemLike, isSystemLikeType, SYSTEM_LIKE_TYPES } from './elementKinds';

describe('elementKinds (Model rule M2)', () => {
  it('counts a system and a module as system-like', () => {
    expect(isSystemLikeType('system')).toBe(true);
    expect(isSystemLikeType('container')).toBe(true);
    expect(isSystemLike({ element_type: 'container' })).toBe(true);
  });

  it('does not count capabilities, actors or value streams', () => {
    for (const type of ['capability', 'actor', 'value_stream']) expect(isSystemLikeType(type)).toBe(false);
  });

  it('lists exactly the two types', () => {
    expect([...SYSTEM_LIKE_TYPES]).toEqual(['system', 'container']);
  });
});
