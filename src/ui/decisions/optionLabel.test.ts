import { describe, expect, it } from 'vitest';
import { stripIntentPrefix } from './optionLabel';

describe('stripIntentPrefix', () => {
  it('removes the change-intent prefix a person should not read', () => {
    expect(stripIntentPrefix('Exploring: Replace the ledger')).toBe('Replace the ledger');
    expect(stripIntentPrefix('Proposing: Bring in the new CRM')).toBe('Bring in the new CRM');
    expect(stripIntentPrefix('Recording: Dynamics went live')).toBe('Dynamics went live');
  });

  it('leaves a title without a prefix alone, and trims it', () => {
    expect(stripIntentPrefix('  Replace the ledger  ')).toBe('Replace the ledger');
  });

  it('does not strip a word that merely starts like a prefix', () => {
    expect(stripIntentPrefix('Exploring options')).toBe('Exploring options');
  });
});
