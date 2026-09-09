import { describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { describeEnvelope, type NameLookup } from './describeEnvelope';

const NAMES: Record<string, string> = {
  powerOn: 'PowerON',
  outageAndFault: 'Outage & Fault Management',
  networkControl: 'Network Control',
  networkOperations: 'Network Operations',
  northgate: 'Northgate',
};

const nameLookup: NameLookup = (id) => NAMES[id];

function base(overrides: Partial<Delta> & Pick<Delta, 'kind'>): Delta {
  return { id: 'd1', sourceId: 'src-1', confidence: 1, ...overrides } as Delta;
}

describe('describeEnvelope', () => {
  it('element.create: "Add {type} {name}"', () => {
    const delta = base({ kind: 'element.create', elementId: 'powerOn', elementType: 'system', name: 'PowerON', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false } });
    expect(describeEnvelope([delta], nameLookup)).toBe('Add system PowerON');
  });

  it('element.update (name): "Rename {old} to {new}"', () => {
    const delta = base({ kind: 'element.update', elementId: 'northgate', elementType: 'system', attribute: 'name', value: 'Northgate Hub', previousDeltaId: 'p1' });
    expect(describeEnvelope([delta], nameLookup)).toBe('Rename Northgate to Northgate Hub');
  });

  it('element.update (parentId, set): "Move {name} to {newParentName}"', () => {
    const delta = base({ kind: 'element.update', elementId: 'powerOn', elementType: 'system', attribute: 'parentId', value: 'networkOperations', previousDeltaId: 'p1' });
    expect(describeEnvelope([delta], nameLookup)).toBe('Move PowerON to Network Operations');
  });

  it('element.update (parentId, cleared): "Move {name} to top level"', () => {
    const delta = base({ kind: 'element.update', elementId: 'powerOn', elementType: 'system', attribute: 'parentId', value: null, previousDeltaId: 'p1' });
    expect(describeEnvelope([delta], nameLookup)).toBe('Move PowerON to top level');
  });

  it('element.update (a plain attribute): "Set {name} {label} to {value}"', () => {
    const delta = base({ kind: 'element.update', elementId: 'powerOn', elementType: 'system', attribute: 'vendor', value: 'Acme Corp', previousDeltaId: 'p1' });
    expect(describeEnvelope([delta], nameLookup)).toBe('Set PowerON vendor to Acme Corp');
  });

  it('element.update (a plain attribute, cleared): "Clear {name} {label}"', () => {
    const delta = base({ kind: 'element.update', elementId: 'powerOn', elementType: 'system', attribute: 'vendor', value: null, previousDeltaId: 'p1' });
    expect(describeEnvelope([delta], nameLookup)).toBe('Clear PowerON vendor');
  });

  it('element.update (a boolean attribute): renders Yes/No, not true/false', () => {
    const delta = base({ kind: 'element.update', elementId: 'powerOn', elementType: 'system', attribute: 'isExternal', value: true, previousDeltaId: 'p1' });
    expect(describeEnvelope([delta], nameLookup)).toBe('Set PowerON external to Yes');
  });

  it('element.retract: "Retract {name}"', () => {
    const delta = base({ kind: 'element.retract', elementId: 'northgate', elementType: 'system', previousDeltaId: 'p1' });
    expect(describeEnvelope([delta], nameLookup)).toBe('Retract Northgate');
  });

  it('element.restore: "Restore {name}"', () => {
    const delta = base({ kind: 'element.restore', elementId: 'northgate', elementType: 'system', previousDeltaId: 'p1' });
    expect(describeEnvelope([delta], nameLookup)).toBe('Restore Northgate');
  });

  it('relationship.create (supports): "Link {from} supports {to}"', () => {
    const delta = base({ kind: 'relationship.create', relationshipId: 'r1', relationshipType: 'supports', fromElementId: 'powerOn', toElementId: 'outageAndFault', attributes: {} });
    expect(describeEnvelope([delta], nameLookup)).toBe('Link PowerON supports Outage & Fault Management');
  });

  it('relationship.create (uses): the outbound verb is "uses"', () => {
    const delta = base({ kind: 'relationship.create', relationshipId: 'r1', relationshipType: 'uses', fromElementId: 'powerOn', toElementId: 'northgate', attributes: {} });
    expect(describeEnvelope([delta], nameLookup)).toBe('Link PowerON uses Northgate');
  });

  it('relationship.create (flows_to): the outbound verb is "flows to", not the raw key', () => {
    const delta = base({ kind: 'relationship.create', relationshipId: 'r1', relationshipType: 'flows_to', fromElementId: 'powerOn', toElementId: 'northgate', attributes: {} });
    expect(describeEnvelope([delta], nameLookup)).toBe('Link PowerON flows to Northgate');
  });

  it('relationship.create (owns): "Set {to} owner to {from}", not "Link {from} owns {to}"', () => {
    const delta = base({ kind: 'relationship.create', relationshipId: 'r1', relationshipType: 'owns', fromElementId: 'networkControl', toElementId: 'powerOn', attributes: { primary: true } });
    expect(describeEnvelope([delta], nameLookup)).toBe('Set PowerON owner to Network Control');
  });

  it('relationship.update: no endpoint ids are on the delta, so this names the relationship type, not its endpoints', () => {
    const delta = base({ kind: 'relationship.update', relationshipId: 'r1', relationshipType: 'owns', attribute: 'primary', value: false, previousDeltaId: 'p1' });
    expect(describeEnvelope([delta], nameLookup)).toBe('Set owns primary to No');
  });

  it('relationship.update (cleared): "Clear {type} {label}"', () => {
    const delta = base({ kind: 'relationship.update', relationshipId: 'r1', relationshipType: 'flows_to', attribute: 'dataClassification', value: null, previousDeltaId: 'p1' });
    expect(describeEnvelope([delta], nameLookup)).toBe('Clear flows_to data classification');
  });

  it('relationship.retract: generic, type-only — no endpoint ids on the delta at all', () => {
    const delta = base({ kind: 'relationship.retract', relationshipId: 'r1', relationshipType: 'supports', previousDeltaId: 'p1' });
    expect(describeEnvelope([delta], nameLookup)).toBe('Retract the supports relationship');
  });

  it('relationship.restore: generic, type-only, same as retract', () => {
    const delta = base({ kind: 'relationship.restore', relationshipId: 'r1', relationshipType: 'owns', previousDeltaId: 'p1' });
    expect(describeEnvelope([delta], nameLookup)).toBe('Restore the owns relationship');
  });

  it('a create-and-link pair: "Add {type} {name} and link to {other} (2 changes)"', () => {
    const create = base({ kind: 'element.create', elementId: 'powerOn', elementType: 'system', name: 'PowerON', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false } });
    const link = base({ kind: 'relationship.create', relationshipId: 'r1', relationshipType: 'owns', fromElementId: 'networkControl', toElementId: 'powerOn', attributes: { primary: true } });
    expect(describeEnvelope([create, link], nameLookup)).toBe('Add system PowerON and link to Network Control (2 changes)');
  });

  it('a create-and-link pair works in either endpoint direction', () => {
    const create = base({ kind: 'element.create', elementId: 'powerOn', elementType: 'system', name: 'PowerON', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false } });
    const link = base({ kind: 'relationship.create', relationshipId: 'r1', relationshipType: 'supports', fromElementId: 'powerOn', toElementId: 'networkOperations', attributes: {} });
    expect(describeEnvelope([create, link], nameLookup)).toBe('Add system PowerON and link to Network Operations (2 changes)');
  });

  it('more than one change with no nicer combined phrasing: the first delta plus a count', () => {
    const first = base({ kind: 'element.update', elementId: 'powerOn', elementType: 'system', attribute: 'vendor', value: 'Acme Corp', previousDeltaId: 'p1' });
    const second = base({ id: 'd2', kind: 'element.update', elementId: 'powerOn', elementType: 'system', attribute: 'isExternal', value: false, previousDeltaId: 'p2' });
    const third = base({ id: 'd3', kind: 'element.update', elementId: 'powerOn', elementType: 'system', attribute: 'description', value: 'A thing', previousDeltaId: 'p3' });
    expect(describeEnvelope([first, second, third], nameLookup)).toBe('Set PowerON vendor to Acme Corp (3 changes)');
  });

  it('two unrelated deltas (not a create-and-link pair) fall back to the count form too', () => {
    const retract = base({ kind: 'element.retract', elementId: 'northgate', elementType: 'system', previousDeltaId: 'p1' });
    const create = base({ id: 'd2', kind: 'element.create', elementId: 'powerOn', elementType: 'system', name: 'PowerON', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false } });
    expect(describeEnvelope([retract, create], nameLookup)).toBe('Retract Northgate (2 changes)');
  });

  it('an unresolvable element id falls back to a clear placeholder, not a crash or a raw uuid', () => {
    const delta = base({ kind: 'element.retract', elementId: 'ghost-id', elementType: 'system', previousDeltaId: 'p1' });
    expect(describeEnvelope([delta], nameLookup)).toBe('Retract (unknown)');
  });

  it('zero deltas (a merge commit\'s own valid empty case, C1) never throws', () => {
    expect(describeEnvelope([], nameLookup)).toBe('No changes');
  });
});
