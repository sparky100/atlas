import { describe, expect, it } from 'vitest';
import { optionDraftActions, optionDraftLabel, optionKindOf } from './optionDraftActions';

const sys = (n: number, name: string) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name });
const labels = (kind: Parameters<typeof optionDraftActions>[0], concerned: ReturnType<typeof sys>[], supporters: ReturnType<typeof sys>[], caps: string[]) => optionDraftActions(kind, concerned, supporters, caps).map(optionDraftLabel);

describe('optionKindOf', () => {
  it('reads the Designer\'s four options, and nothing else', () => {
    expect(optionKindOf('Keep and tidy up')).toBe('keep');
    expect(optionKindOf('Configure what we already run')).toBe('configure');
    expect(optionKindOf('Replace with a product')).toBe('replace');
    expect(optionKindOf('Build ourselves')).toBe('build');
    expect(optionKindOf('Buy a licence from a vendor')).toBeNull();
  });
});

describe('optionDraftActions', () => {
  const quote = sys(1, 'Quote Tool');

  it('replace: retire and replace the supporting system, never "extend"', () => {
    expect(labels('replace', [], [quote], ['Connection Quotations'])).toEqual(['Retire Quote Tool and replace it with a new system']);
  });

  it('replace: a system the decision names and the same system as supporter appear once', () => {
    expect(labels('replace', [quote], [quote, sys(2, 'IS-U')], ['Billing'])).toEqual(['Retire Quote Tool and replace it with a new system', 'Retire IS-U and replace it with a new system']);
  });

  it('configure: extend the supporting system to cover the capability', () => {
    expect(labels('configure', [], [quote], ['Connection Quotations'])).toEqual(['Extend Quote Tool to cover Connection Quotations']);
  });

  it('configure: nothing to extend when the decision names no capability', () => {
    expect(labels('configure', [], [quote], [])).toEqual([]);
  });

  it('build: create a new system for the capability, with no existing system named', () => {
    expect(labels('build', [], [quote], ['Connection Quotations'])).toEqual(['Create a new system for Connection Quotations']);
    expect(labels('build', [], [], [])).toEqual(['Create a new system']);
  });

  it('keep and unknown options get no starter', () => {
    expect(labels('keep', [quote], [quote], ['C'])).toEqual([]);
    expect(labels(null, [quote], [quote], ['C'])).toEqual([]);
  });

  it('caps replace at three', () => {
    const many = [1, 2, 3, 4, 5].map((n) => sys(n, `S${String(n)}`));
    expect(optionDraftActions('replace', many, [], ['C'])).toHaveLength(3);
  });
});
