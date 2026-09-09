import { describe, expect, it } from 'vitest';
import { defaultUserPreferences, fromUserPreferencesRow, toUserPreferencesRow } from './userPreferences';

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

  it('defaults capabilityMapColourBy to null — no row means no saved override (Sprint U4-1 C4)', () => {
    expect(defaultUserPreferences('u1', false).capabilityMapColourBy).toBeNull();
  });
});

describe('capabilityMapColourBy wire <-> row (Sprint U4-1 C4)', () => {
  it('carries a real mode through toUserPreferencesRow/fromUserPreferencesRow unchanged', () => {
    const prefs = { ...defaultUserPreferences('u1', true), capabilityMapColourBy: 'metric:lifecycleExposure' as const };
    const row = toUserPreferencesRow(prefs);
    expect(row.capability_map_colour_by).toBe('metric:lifecycleExposure');
    expect(fromUserPreferencesRow(row).capabilityMapColourBy).toBe('metric:lifecycleExposure');
  });

  it('carries null through unchanged', () => {
    const row = toUserPreferencesRow(defaultUserPreferences('u1', true));
    expect(row.capability_map_colour_by).toBeNull();
    expect(fromUserPreferencesRow(row).capabilityMapColourBy).toBeNull();
  });
});
