import { describe, expect, it } from 'vitest';
import { domainOf, domainToneFor, resolveElementDomain } from './systemDomain';
import type { ElementsHeadRow, Json } from '../../contracts/rows';

function element(id: string, type: ElementsHeadRow['element_type'], parentId: string | null = null, attributes: Record<string, Json> = {}): ElementsHeadRow {
  return { element_id: id, element_type: type, name: id, parent_id: parentId, attributes, exists_delta_id: `delta-${id}` };
}

describe('domainOf (Prompt 7k item 3)', () => {
  it('reads a recorded domain', () => {
    expect(domainOf(element('sys-1', 'system', null, { domain: 'ot' }))).toBe('ot');
    expect(domainOf(element('sys-2', 'system', null, { domain: 'hybrid' }))).toBe('hybrid');
  });

  it('defaults to "it" when absent', () => {
    expect(domainOf(element('sys-1', 'system'))).toBe('it');
  });

  it('defaults to "it" for an unrecognised value', () => {
    expect(domainOf(element('sys-1', 'system', null, { domain: 'nonsense' }))).toBe('it');
  });
});

describe('domainToneFor', () => {
  it('is neutral for it, warn for ot, info for hybrid', () => {
    expect(domainToneFor('it')).toBe('neutral');
    expect(domainToneFor('ot')).toBe('warn');
    expect(domainToneFor('hybrid')).toBe('info');
  });

  it('is undefined for an unrecognised value', () => {
    expect(domainToneFor('nonsense')).toBeUndefined();
  });
});

describe('resolveElementDomain (Prompt 7k item 3)', () => {
  it("a system reads its own domain", () => {
    const system = element('sys-1', 'system', null, { domain: 'ot' });
    expect(resolveElementDomain(system, new Map([['sys-1', system]]))).toBe('ot');
  });

  it("a container inherits its parent system's domain", () => {
    const system = element('sys-1', 'system', null, { domain: 'ot' });
    const container = element('cont-1', 'container', 'sys-1');
    const byId = new Map([
      ['sys-1', system],
      ['cont-1', container],
    ]);
    expect(resolveElementDomain(container, byId)).toBe('ot');
  });

  it("a component inherits through its container's parent system", () => {
    const system = element('sys-1', 'system', null, { domain: 'ot' });
    const container = element('cont-1', 'container', 'sys-1');
    const component = element('comp-1', 'component', 'cont-1');
    const byId = new Map([
      ['sys-1', system],
      ['cont-1', container],
      ['comp-1', component],
    ]);
    expect(resolveElementDomain(component, byId)).toBe('ot');
  });

  it('defaults to "it" when the parent chain never reaches a system', () => {
    const container = element('cont-1', 'container', 'missing-parent');
    expect(resolveElementDomain(container, new Map([['cont-1', container]]))).toBe('it');
  });

  it('"platforms and modules": a container with its own domain override reads that, not its parent system\'s', () => {
    const system = element('sys-1', 'system', null, { domain: 'it' });
    const module = element('cont-1', 'container', 'sys-1', { domain: 'ot' });
    const byId = new Map([
      ['sys-1', system],
      ['cont-1', module],
    ]);
    expect(resolveElementDomain(module, byId)).toBe('ot');
  });

  it('an ordinary container that never sets its own domain still falls through to the parent walk, unchanged', () => {
    const system = element('sys-1', 'system', null, { domain: 'ot' });
    const container = element('cont-1', 'container', 'sys-1');
    const byId = new Map([
      ['sys-1', system],
      ['cont-1', container],
    ]);
    expect(resolveElementDomain(container, byId)).toBe('ot');
  });
});
