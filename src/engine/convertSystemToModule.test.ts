/**
 * `buildConvertSystemToModuleDeltas` — mirrors `mergeElements.test.ts`'s own
 * shape: small, concrete fixtures folded through the real `apply()`/`fold`,
 * so a passing test proves the resulting commit is actually valid per the
 * engine's own rules (C8/C9/V2), not just that this function's own return
 * value looks right.
 */
import { describe, expect, it } from 'vitest';
import type { Delta, UUID } from '../contracts/delta';
import { cloneHead, emptyHead, fold, type CommitContext, type Head } from './deltas';
import { EngineError } from './errors';
import { buildConvertSystemToModuleDeltas } from './convertSystemToModule';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };
const SOURCE_ID = 'convert-to-module-source';
let seq = 0;
const mintId = () => `minted-${String((seq += 1))}`;

function createElement(id: UUID, elementId: UUID, elementType: string, name: string, parentId: UUID | null = null, attributes: Record<string, unknown> = {}): Delta {
  return { kind: 'element.create', id, elementId, elementType, name, parentId, attributes, sourceId: SOURCE_ID, confidence: 1 } as never;
}

function createRelationship(id: UUID, relationshipId: UUID, relationshipType: string, fromElementId: UUID, toElementId: UUID, attributes: Record<string, unknown> = {}): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType, fromElementId, toElementId, attributes, sourceId: SOURCE_ID, confidence: 1 } as never;
}

function headFrom(deltas: Delta[]): Head {
  return fold(emptyHead(), deltas, ctx);
}

const SYSTEM_ATTRS = { lifecycleStatus: 'active', isExternal: false };

describe('buildConvertSystemToModuleDeltas', () => {
  it('creates a container parented on the target platform, carrying over shared attributes', () => {
    const head = headFrom([
      createElement('d-sap', 'sap', 'system', 'SAP', null, SYSTEM_ATTRS),
      createElement('d-sys', 'sys', 'system', 'Freight Tracker', null, { lifecycleStatus: 'active', isExternal: false, criticality: 'high', domain: 'ot', version: '2.1' }),
    ]);
    const { deltas, newContainerId } = buildConvertSystemToModuleDeltas(cloneHead(head), 'sys', 'sap', SOURCE_ID, mintId);
    const create = deltas.find((d) => d.kind === 'element.create');
    expect(create).toMatchObject({
      kind: 'element.create',
      elementId: newContainerId,
      elementType: 'container',
      name: 'Freight Tracker',
      parentId: 'sap',
      attributes: { lifecycleStatus: 'active', isExternal: false, criticality: 'high', domain: 'ot', version: '2.1' },
    });

    const resultingHead = fold(cloneHead(head), deltas, ctx);
    expect(resultingHead.elements.has('sys')).toBe(false);
    expect(resultingHead.elements.get(newContainerId)).toMatchObject({ elementType: 'container', parentId: 'sap', name: 'Freight Tracker' });
  });

  it('reports system-only attributes as dropped and omits them from the new container', () => {
    const head = headFrom([
      createElement('d-sap', 'sap', 'system', 'SAP', null, SYSTEM_ATTRS),
      createElement('d-sys', 'sys', 'system', 'Freight Tracker', null, { lifecycleStatus: 'active', isExternal: true, vendor: 'Acme', externalOrganisation: 'Acme Corp', kind: 'application', supportEndsAt: '2027-01-01' }),
    ]);
    const { deltas, droppedAttributeKeys, newContainerId } = buildConvertSystemToModuleDeltas(cloneHead(head), 'sys', 'sap', SOURCE_ID, mintId);
    expect(new Set(droppedAttributeKeys)).toEqual(new Set(['vendor', 'externalOrganisation', 'kind', 'supportEndsAt']));
    const create = deltas.find((d) => d.kind === 'element.create' && d.elementId === newContainerId);
    if (create?.kind === 'element.create') {
      expect(create.attributes).not.toHaveProperty('vendor');
      expect(create.attributes).not.toHaveProperty('externalOrganisation');
      expect(create.attributes).not.toHaveProperty('kind');
      expect(create.attributes).not.toHaveProperty('supportEndsAt');
      expect(create.attributes).toMatchObject({ isExternal: true });
    }
  });

  it('carries a supports edge (the system as the anchor) onto the new container id', () => {
    const head = headFrom([
      createElement('d-sap', 'sap', 'system', 'SAP', null, SYSTEM_ATTRS),
      createElement('d-sys', 'sys', 'system', 'Freight Tracker', null, SYSTEM_ATTRS),
      createElement('d-cap', 'cap', 'capability', 'Logistics'),
      createRelationship('d-sup', 'rel-sup', 'supports', 'sys', 'cap', { role: 'primary' }),
    ]);
    const { deltas, newContainerId, relationships } = buildConvertSystemToModuleDeltas(cloneHead(head), 'sys', 'sap', SOURCE_ID, mintId);
    expect(relationships).toEqual([{ relationshipId: 'rel-sup', relationshipType: 'supports', otherElementId: 'cap', side: 'from' }]);

    const resultingHead = fold(cloneHead(head), deltas, ctx);
    const supportsEdges = [...resultingHead.relationships.values()].filter((r) => r.relationshipType === 'supports');
    expect(supportsEdges).toEqual([{ relationshipType: 'supports', fromElementId: newContainerId, toElementId: 'cap', attributes: { role: 'primary' }, existsDeltaId: expect.any(String) }]);
  });

  it('carries a uses edge in both directions, and an owns edge where the system is the owned (to) side', () => {
    const head = headFrom([
      createElement('d-sap', 'sap', 'system', 'SAP', null, SYSTEM_ATTRS),
      createElement('d-sys', 'sys', 'system', 'Freight Tracker', null, SYSTEM_ATTRS),
      createElement('d-other', 'other', 'system', 'Other', null, SYSTEM_ATTRS),
      createElement('d-actor', 'actor-1', 'actor', 'Jane Doe', null, { subtype: 'person', isExternal: false }),
      createRelationship('d-uses-out', 'rel-uses-out', 'uses', 'sys', 'other', { description: 'reads from' }),
      createRelationship('d-uses-in', 'rel-uses-in', 'uses', 'other', 'sys', { description: 'writes to' }),
      createRelationship('d-owns', 'rel-owns', 'owns', 'actor-1', 'sys', { role: 'business' }),
    ]);
    const { deltas, newContainerId, relationships } = buildConvertSystemToModuleDeltas(cloneHead(head), 'sys', 'sap', SOURCE_ID, mintId);
    expect(relationships).toHaveLength(3);

    const resultingHead = fold(cloneHead(head), deltas, ctx);
    const usesOut = [...resultingHead.relationships.values()].find((r) => r.relationshipType === 'uses' && r.attributes.description === 'reads from');
    const usesIn = [...resultingHead.relationships.values()].find((r) => r.relationshipType === 'uses' && r.attributes.description === 'writes to');
    const owns = [...resultingHead.relationships.values()].find((r) => r.relationshipType === 'owns');
    expect(usesOut).toMatchObject({ fromElementId: newContainerId, toElementId: 'other' });
    expect(usesIn).toMatchObject({ fromElementId: 'other', toElementId: newContainerId });
    expect(owns).toMatchObject({ fromElementId: 'actor-1', toElementId: newContainerId, attributes: { role: 'business' } });
  });

  it('retracts the old system last, once nothing live still references it (C8)', () => {
    const head = headFrom([
      createElement('d-sap', 'sap', 'system', 'SAP', null, SYSTEM_ATTRS),
      createElement('d-sys', 'sys', 'system', 'Freight Tracker', null, SYSTEM_ATTRS),
      createElement('d-other', 'other', 'system', 'Other', null, SYSTEM_ATTRS),
      createRelationship('d-uses', 'rel-uses', 'uses', 'sys', 'other'),
    ]);
    const { deltas } = buildConvertSystemToModuleDeltas(cloneHead(head), 'sys', 'sap', SOURCE_ID, mintId);
    // Folding must not throw — C8 requires every relationship touching
    // `sys` to be retracted or repointed strictly before `sys` itself is
    // retracted; a wrong delta order here would throw during this fold.
    expect(() => fold(cloneHead(head), deltas, ctx)).not.toThrow();
    expect(deltas[deltas.length - 1]).toMatchObject({ kind: 'element.retract', elementId: 'sys' });
  });

  it('refuses to convert a system into a module of itself', () => {
    const head = headFrom([createElement('d-sys', 'sys', 'system', 'Freight Tracker', null, SYSTEM_ATTRS)]);
    expect(() => buildConvertSystemToModuleDeltas(cloneHead(head), 'sys', 'sys', SOURCE_ID, mintId)).toThrow(EngineError);
  });

  it('refuses when the system does not exist', () => {
    const head = headFrom([createElement('d-sap', 'sap', 'system', 'SAP', null, SYSTEM_ATTRS)]);
    expect(() => buildConvertSystemToModuleDeltas(cloneHead(head), 'missing', 'sap', SOURCE_ID, mintId)).toThrow(EngineError);
  });

  it('refuses when the target platform does not exist', () => {
    const head = headFrom([createElement('d-sys', 'sys', 'system', 'Freight Tracker', null, SYSTEM_ATTRS)]);
    expect(() => buildConvertSystemToModuleDeltas(cloneHead(head), 'sys', 'missing', SOURCE_ID, mintId)).toThrow(EngineError);
  });

  it('refuses when the target is not a system', () => {
    const head = headFrom([createElement('d-sys', 'sys', 'system', 'Freight Tracker', null, SYSTEM_ATTRS), createElement('d-cap', 'cap', 'capability', 'Logistics')]);
    expect(() => buildConvertSystemToModuleDeltas(cloneHead(head), 'sys', 'cap', SOURCE_ID, mintId)).toThrow(EngineError);
  });

  it('refuses when the element being converted is not itself a system', () => {
    const head = headFrom([createElement('d-sap', 'sap', 'system', 'SAP', null, SYSTEM_ATTRS), createElement('d-mod', 'mod', 'container', 'PM', 'sap')]);
    expect(() => buildConvertSystemToModuleDeltas(cloneHead(head), 'mod', 'sap', SOURCE_ID, mintId)).toThrow(EngineError);
  });

  it('refuses to convert a system that already has its own children (a platform with modules)', () => {
    const head = headFrom([
      createElement('d-sap', 'sap', 'system', 'SAP', null, SYSTEM_ATTRS),
      createElement('d-sys', 'sys', 'system', 'Freight Tracker', null, SYSTEM_ATTRS),
      createElement('d-mod', 'mod', 'container', 'Tracking', 'sys'),
    ]);
    expect(() => buildConvertSystemToModuleDeltas(cloneHead(head), 'sys', 'sap', SOURCE_ID, mintId)).toThrow(EngineError);
  });
});
