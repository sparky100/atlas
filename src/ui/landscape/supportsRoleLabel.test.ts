import { describe, expect, it } from 'vitest';
import { supportsRoleLabel } from './supportsRoleLabel';

describe('supportsRoleLabel', () => {
  it('maps the stored values to plain words', () => {
    expect(supportsRoleLabel('primary')).toBe('Main');
    expect(supportsRoleLabel('secondary')).toBe('Also');
  });
  it('passes an unknown value through unchanged', () => {
    expect(supportsRoleLabel('other')).toBe('other');
  });
});
