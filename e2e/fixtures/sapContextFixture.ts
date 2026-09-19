/**
 * Seeds `SAP_MODULES` and `PM_CONTEXT_SCENARIO`
 * (`src/ui/context/fixtures/sapContext.ts` — the Context diagram's standing
 * density fixture) into a real model, on top of
 * `bootstrapChangeBranchFixture`'s freshly signed-up owner: SAP as a
 * platform with its eight modules and their capabilities (the
 * platform-structure page's own fixture), and PM's own real 8 neighbours
 * and 12 relationships, one external system, exactly one two-way pair
 * (the Context diagram's own density fixture, now scoped to a single
 * module's own page — V3). One `manual` commit through the real
 * `commitToBranch` path, so the seeded head is exactly what a person would
 * have built by hand.
 */
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../../src/contracts/delta';
import { commitToBranch } from '../../src/db/commits';
import type { Env } from '../../src/db/env';
import { getOrCreateManualSource } from '../../src/db/sources';
import { PM_CONTEXT_SCENARIO, SAP_HUB_DESCRIPTION, SAP_HUB_NAME, SAP_MODULES, type ContainerContextScenario } from '../../src/ui/context/fixtures/sapContext';
import { bootstrapChangeBranchFixture, type ChangeBranchFixture } from './changeBranchFixture';

export interface SapContextFixture extends ChangeBranchFixture {
  /** The hub (SAP) — `bootstrapChangeBranchFixture`'s own seeded system, switched to `kind: 'platform'`. */
  sapId: string;
  moduleIdByCode: Map<string, string>;
  neighbourIdByKey: Map<string, string>;
  scenario: ContainerContextScenario;
}

export async function seedSapContextFixture(page: Page, env: Env, prefix: string, scenario: ContainerContextScenario = PM_CONTEXT_SCENARIO): Promise<SapContextFixture> {
  const fixture = await bootstrapChangeBranchFixture(page, env, prefix, SAP_HUB_NAME);
  const { signedIn: owner, orgId, modelId, systemId: sapId, userId: ownerId, main } = fixture;
  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });

  const moduleIdByCode = new Map(SAP_MODULES.map((m) => [m.code, randomUUID()]));
  const capabilityIdByCode = new Map(SAP_MODULES.map((m) => [m.code, randomUUID()]));
  const neighbourIdByKey = new Map(scenario.neighbours.map((n) => [n.key, randomUUID()]));
  const hubModuleId = moduleIdByCode.get(scenario.hubModuleCode) ?? '';

  const deltas: Delta[] = [
    { kind: 'element.update', id: randomUUID(), elementId: sapId, elementType: 'system', attribute: 'kind', value: 'platform', previousDeltaId: fixture.createDeltaId, sourceId: source.id, confidence: 1 },
    { kind: 'element.update', id: randomUUID(), elementId: sapId, elementType: 'system', attribute: 'description', value: SAP_HUB_DESCRIPTION, previousDeltaId: fixture.createDeltaId, sourceId: source.id, confidence: 1 },
  ];
  for (const module of SAP_MODULES) {
    const moduleId = moduleIdByCode.get(module.code) ?? '';
    const capabilityId = capabilityIdByCode.get(module.code) ?? '';
    deltas.push(
      { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: module.capability, parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: moduleId, elementType: 'container', name: module.name, parentId: sapId, attributes: { isExternal: false }, sourceId: source.id, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: moduleId, toElementId: capabilityId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
    );
  }
  for (const neighbour of scenario.neighbours) {
    const neighbourId = neighbourIdByKey.get(neighbour.key) ?? '';
    if (neighbour.elementType === 'actor') {
      deltas.push({
        kind: 'element.create',
        id: randomUUID(),
        elementId: neighbourId,
        elementType: 'actor',
        name: neighbour.name,
        parentId: null,
        attributes: { subtype: 'organisation', isExternal: neighbour.isExternal, ...(neighbour.externalOrganisation ? { externalOrganisation: neighbour.externalOrganisation } : {}) },
        sourceId: source.id,
        confidence: 1,
      });
    } else {
      deltas.push({
        kind: 'element.create',
        id: randomUUID(),
        elementId: neighbourId,
        elementType: 'system',
        name: neighbour.name,
        parentId: null,
        attributes: { lifecycleStatus: 'active', isExternal: neighbour.isExternal, ...(neighbour.externalOrganisation ? { externalOrganisation: neighbour.externalOrganisation } : {}) },
        sourceId: source.id,
        confidence: 1,
      });
    }
    // Every flow names the scenario's own hub module directly (V3: a
    // module's own neighbours live on its own Context page, never the
    // platform's) — never `sapId` itself.
    for (const flow of neighbour.flows) {
      const fromElementId = flow.direction === 'in' ? neighbourId : hubModuleId;
      const toElementId = flow.direction === 'in' ? hubModuleId : neighbourId;
      deltas.push({ kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: flow.relationshipType, fromElementId, toElementId, attributes: { description: flow.verb }, sourceId: source.id, confidence: 1 });
    }
  }

  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: `seed the ${SAP_HUB_NAME} context fixture`, body: null, deltas };
  const result = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!result.ok) throw new Error(`seed SAP context fixture: ${result.message}`);

  return { ...fixture, sapId, moduleIdByCode, neighbourIdByKey, scenario };
}
