import { describe, expect, it } from 'vitest';
import { defaultUserPreferences } from './userPreferences';

describe('defaultUserPreferences', () => {
  it('gives owners/architects the architect door and everyone else the director door', () => {
    expect(defaultUserPreferences('u1', true).homeMode).toBe('architect');
    expect(defaultUserPreferences('u1', false).homeMode).toBe('director');
  });

  it('defaults theme to system and density to comfortable, per SPEC §3.2', () => {
    const prefs = defaultUserPreferences('u1', false);
    expect(prefs.theme).toBe('system');
    expect(prefs.density).toBe('comfortable');
  });
});
