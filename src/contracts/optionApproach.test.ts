import { describe, expect, it } from 'vitest';
import { approachFromTitle, isOptionApproach, OPTION_APPROACH_LABELS } from './optionApproach';
import { designerApproach } from './designerOptions';

describe('option approach', () => {
  it('labels every approach in plain words, with Buy for the product option', () => {
    expect(OPTION_APPROACH_LABELS).toEqual({ keep: 'Keep', use: 'Use', configure: 'Configure', buy: 'Buy', build: 'Build', no_change: 'No change' });
  });

  it('accepts only the stored values', () => {
    expect(isOptionApproach('buy')).toBe(true);
    expect(isOptionApproach('use')).toBe(true);
    expect(isOptionApproach('replace')).toBe(false);
    expect(isOptionApproach(null)).toBe(false);
  });

  it('reads the old title rule, with Replace and Buy both meaning Buy, and guesses nothing else', () => {
    expect(approachFromTitle('Keep and tidy up')).toBe('keep');
    expect(approachFromTitle('Configure what we already run')).toBe('configure');
    expect(approachFromTitle('Replace with a product')).toBe('buy');
    expect(approachFromTitle('Buy a product')).toBe('buy');
    expect(approachFromTitle('Build ourselves')).toBe('build');
    expect(approachFromTitle('Move quoting to a SaaS tool')).toBeNull();
    expect(approachFromTitle('Rebuild the quote engine')).toBeNull();
  });

  it('takes the Designer\'s own approach over its title, and never lets it claim No change', () => {
    expect(designerApproach('build', 'Replace with a product')).toBe('build');
    expect(designerApproach(undefined, 'Replace with a product')).toBe('buy');
    expect(designerApproach('no_change', 'Keep and tidy up')).toBe('keep');
    expect(designerApproach('nonsense', 'A new idea')).toBeNull();
  });
});
