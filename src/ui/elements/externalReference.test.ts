import { describe, expect, it } from 'vitest';
import { normaliseExternalReference } from './externalReference';

describe('normaliseExternalReference', () => {
  it('keeps only the hostname of a pasted URL', () => {
    expect(normaliseExternalReference('https://mprs.example.com/api/v1?x=1')).toBe('mprs.example.com');
  });

  it('keeps a bare value as typed, trimmed', () => {
    expect(normaliseExternalReference('  mprs.example.com  ')).toBe('mprs.example.com');
    expect(normaliseExternalReference('CRM-0042')).toBe('CRM-0042');
  });

  it('rejects an empty or unreadable value', () => {
    expect(normaliseExternalReference('   ')).toBeNull();
    expect(normaliseExternalReference('https://')).toBeNull();
  });
});
