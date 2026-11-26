import { describe, expect, it } from 'vitest';
import { optionDraftActions, optionDraftLabel } from './optionDraftActions';

const sys = (n: number, name: string) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name });
const labels = (kind: Parameters<typeof optionDraftActions>[0], concerned: ReturnType<typeof sys>[], supporters: ReturnType<typeof sys>[], caps: string[]) => optionDraftActions(kind, concerned, supporters, caps).map(optionDraftLabel);

describe('optionDraftActions', () => {
  const quote = sys(1, 'Quote Tool');

  it('buy: retire and replace the supporting system, never "extend"', () => {
    expect(labels('buy', [], [quote], ['Connection Quotations'])).toEqual(['Retire Quote Tool and replace it with a new system']);
  });

  it('buy: only the system the decision names, not the capability\'s other supporters', () => {
    expect(labels('buy', [quote], [quote, sys(2, 'IS-U')], ['Billing'])).toEqual(['Retire Quote Tool and replace it with a new system']);
  });

  it('buy: Smallworld GIS decision offers only Smallworld GIS, though other systems support the capability', () => {
    const smallworld = sys(3, 'Smallworld GIS');
    const others = [sys(4, 'Utility Network'), sys(5, 'DIgSILENT PowerFactory')];
    expect(labels('buy', [smallworld], [smallworld, ...others], ['Network Mapping'])).toEqual(['Retire Smallworld GIS and replace it with a new system']);
    expect(labels('configure', [smallworld], [smallworld, ...others], ['Network Mapping'])).toEqual(['Extend Smallworld GIS to cover Network Mapping']);
    expect(labels('build', [smallworld], [smallworld, ...others], ['Network Mapping'])).toEqual(['Retire Smallworld GIS and replace it with a custom-built app']);
  });

  it('buy: a decision about a capability, naming no system, offers the capability\'s supporters', () => {
    expect(labels('buy', [], [quote, sys(2, 'IS-U')], ['Billing'])).toEqual(['Retire Quote Tool and replace it with a new system', 'Retire IS-U and replace it with a new system']);
  });

  it('configure: extend the supporting system to cover the capability', () => {
    expect(labels('configure', [], [quote], ['Connection Quotations'])).toEqual(['Extend Quote Tool to cover Connection Quotations']);
  });

  it('configure: nothing to extend when the decision names no capability', () => {
    expect(labels('configure', [], [quote], [])).toEqual([]);
  });

  it('build: retire the existing system and replace it with a custom-built app', () => {
    expect(labels('build', [], [quote], ['Connection Quotations'])).toEqual(['Retire Quote Tool and replace it with a custom-built app']);
  });

  it('build: create a new system only when no existing system is known', () => {
    expect(labels('build', [], [], ['Connection Quotations'])).toEqual(['Create a new system for Connection Quotations']);
    expect(labels('build', [], [], [])).toEqual(['Create a new system']);
  });

  it('keep and unknown options get no starter', () => {
    expect(labels('keep', [quote], [quote], ['C'])).toEqual([]);
    expect(labels(null, [quote], [quote], ['C'])).toEqual([]);
  });

  it('caps buy at three', () => {
    const many = [1, 2, 3, 4, 5].map((n) => sys(n, `S${String(n)}`));
    expect(optionDraftActions('buy', many, [], ['C'])).toHaveLength(3);
  });

  it('names the product a Use <product> option carries as the replacement', () => {
    const actions = optionDraftActions('buy', [sys(1, 'Smallworld GIS')], [], ['Network Mapping'], 'Esri ArcGIS Utility Network');
    expect(actions.map(optionDraftLabel)).toEqual(['Retire Smallworld GIS and replace it with Esri ArcGIS Utility Network']);
    expect(actions[0]?.product).toBe('Esri ArcGIS Utility Network');
    expect(optionDraftActions('buy', [sys(1, 'Smallworld GIS')], [], ['Network Mapping']).map(optionDraftLabel)).toEqual(['Retire Smallworld GIS and replace it with a new system']);
  });
});
