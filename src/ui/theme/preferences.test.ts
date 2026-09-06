import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DENSITY,
  DEFAULT_THEME,
  isDensityPreference,
  isThemePreference,
  readStoredDensityPreference,
  readStoredThemePreference,
  resolveTheme,
} from './preferences';

describe('resolveTheme', () => {
  it('resolves system to dark when the OS prefers dark', () => {
    expect(resolveTheme('system', true)).toBe('dark');
  });

  it('resolves system to light when the OS prefers light', () => {
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('an explicit light/dark preference ignores the OS setting', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('isThemePreference / isDensityPreference', () => {
  it('accepts only the documented literal values', () => {
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('SYSTEM')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference('')).toBe(false);

    expect(isDensityPreference('comfortable')).toBe(true);
    expect(isDensityPreference('compact')).toBe(true);
    expect(isDensityPreference('cozy')).toBe(false);
  });
});

function storageOf(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: () => value };
}

function throwingStorage(): Pick<Storage, 'getItem'> {
  return {
    getItem() {
      throw new DOMException('blocked', 'SecurityError');
    },
  };
}

describe('readStoredThemePreference / readStoredDensityPreference', () => {
  it('reads a valid stored value', () => {
    expect(readStoredThemePreference(storageOf('dark'))).toBe('dark');
    expect(readStoredDensityPreference(storageOf('compact'))).toBe('compact');
  });

  it('falls back to the default on a missing or invalid value', () => {
    expect(readStoredThemePreference(storageOf(null))).toBe(DEFAULT_THEME);
    expect(readStoredThemePreference(storageOf('neon'))).toBe(DEFAULT_THEME);
    expect(readStoredDensityPreference(storageOf(null))).toBe(DEFAULT_DENSITY);
    expect(readStoredDensityPreference(storageOf('roomy'))).toBe(DEFAULT_DENSITY);
  });

  it('falls back to the default rather than throwing when storage access itself throws', () => {
    expect(readStoredThemePreference(throwingStorage())).toBe(DEFAULT_THEME);
    expect(readStoredDensityPreference(throwingStorage())).toBe(DEFAULT_DENSITY);
  });
});
