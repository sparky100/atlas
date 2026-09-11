/**
 * Concrete, worked examples — one per DeltaKind — kept separate from the
 * property tests in delta.property.test.ts. These exist for a human
 * skimming the contract to see one real shape per kind, and to pin down
 * subjectOf/factKeyOf's behaviour in cases worth naming explicitly.
 */
import { describe, expect, it } from 'vitest';
import { EXISTS_ATTRIBUTE, type Delta, factKeyOf, subjectOf } from './delta';
import { fromDeltaRow, toDeltaRow } from './rows';

const ctx = { orgId: 'org-1', modelId: 'model-1', commitId: 'commit-1', seq: 0, createdBy: 'user-1' };

describe('one worked example per DeltaKind', () => {
  it('element.create', () => {
    const d: Delta = {
      kind: 'element.create',
      id: 'delta-1',
      elementId: 'el-1',
      elementType: 'capability',
      name: 'Revenues and Benefits',
      parentId: null,
      attributes: { code: '1.0' },
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(subjectOf(d)).toEqual({ subjectType: 'element', subjectId: 'el-1' });
    expect(factKeyOf(d)).toEqual({ subjectId: 'el-1', attribute: EXISTS_ATTRIBUTE });
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('element.update', () => {
    const d: Delta = {
      kind: 'element.update',
      id: 'delta-2',
      elementId: 'el-1',
      elementType: 'system',
      attribute: 'lifecycleStatus',
      value: 'retiring',
      previousDeltaId: 'delta-1',
      sourceId: 'src-1',
      confidence: 0.8,
    };
    expect(factKeyOf(d)).toEqual({ subjectId: 'el-1', attribute: 'lifecycleStatus' });
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('element.update clearing an optional attribute (value: null)', () => {
    const d: Delta = {
      kind: 'element.update',
      id: 'delta-3',
      elementId: 'el-1',
      elementType: 'system',
      attribute: 'vendor',
      value: null,
      previousDeltaId: 'delta-1',
      sourceId: 'src-1',
      confidence: 1,
    };
    const row = toDeltaRow(d, ctx);
    expect(row.value).toBeNull();
    expect(fromDeltaRow(row)).toEqual(d);
  });

  it('element.retract', () => {
    const d: Delta = {
      kind: 'element.retract',
      id: 'delta-4',
      elementId: 'el-1',
      elementType: 'system',
      previousDeltaId: 'delta-1',
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(factKeyOf(d)).toEqual({ subjectId: 'el-1', attribute: EXISTS_ATTRIBUTE });
    const row = toDeltaRow(d, ctx);
    expect(row.value).toBeNull();
    expect(row.name).toBeNull();
    expect(fromDeltaRow(row)).toEqual(d);
  });

  it('element.restore', () => {
    const d: Delta = {
      kind: 'element.restore',
      id: 'delta-5',
      elementId: 'el-1',
      elementType: 'system',
      previousDeltaId: 'delta-4',
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('relationship.create', () => {
    const d: Delta = {
      kind: 'relationship.create',
      id: 'delta-6',
      relationshipId: 'rel-1',
      relationshipType: 'flows_to',
      fromElementId: 'el-1',
      toElementId: 'el-2',
      attributes: { dataClassification: 'official' },
      sourceId: 'src-1',
      confidence: 0.7,
    };
    expect(subjectOf(d)).toEqual({ subjectType: 'relationship', subjectId: 'rel-1' });
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('relationship.create (supports, with role — Sprint U4-1 B4)', () => {
    const d: Delta = {
      kind: 'relationship.create',
      id: 'delta-6b',
      relationshipId: 'rel-2',
      relationshipType: 'supports',
      fromElementId: 'el-1',
      toElementId: 'el-2',
      attributes: { role: 'primary' },
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('relationship.update (supports.role, primary -> secondary — the demotion half of Sprint U4-1 B4\'s "at most one primary" swap)', () => {
    const d: Delta = {
      kind: 'relationship.update',
      id: 'delta-6c',
      relationshipId: 'rel-2',
      relationshipType: 'supports',
      attribute: 'role',
      value: 'secondary',
      previousDeltaId: 'delta-6b',
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('relationship.update', () => {
    const d: Delta = {
      kind: 'relationship.update',
      id: 'delta-7',
      relationshipId: 'rel-1',
      relationshipType: 'owns',
      attribute: 'role',
      value: 'technical',
      previousDeltaId: 'delta-6',
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('relationship.retract', () => {
    const d: Delta = {
      kind: 'relationship.retract',
      id: 'delta-8',
      relationshipId: 'rel-1',
      relationshipType: 'uses',
      previousDeltaId: 'delta-6',
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('relationship.restore', () => {
    const d: Delta = {
      kind: 'relationship.restore',
      id: 'delta-9',
      relationshipId: 'rel-1',
      relationshipType: 'uses',
      previousDeltaId: 'delta-8',
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });
});

describe('EXISTS_ATTRIBUTE is the fact key for every non-update kind', () => {
  it('is the literal string "$exists"', () => {
    expect(EXISTS_ATTRIBUTE).toBe('$exists');
  });
});

describe('System/Container introduced and plannedEnd', () => {
  it('are accepted at create, both optional, and survive the row round trip', () => {
    const d: Delta = {
      kind: 'element.create',
      id: 'delta-10',
      elementId: 'el-1',
      elementType: 'system',
      name: 'Housing CRM',
      parentId: null,
      attributes: { lifecycleStatus: 'planned', isExternal: false, introduced: '2026-04-01', plannedEnd: '2031-04-01' },
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('a container can have plannedEnd set later via an update, with no introduced at create', () => {
    const create: Delta = {
      kind: 'element.create',
      id: 'delta-11',
      elementId: 'el-2',
      elementType: 'container',
      name: 'Integration Platform',
      parentId: 'el-1',
      attributes: { isExternal: false },
      sourceId: 'src-1',
      confidence: 1,
    };
    const update: Delta = {
      kind: 'element.update',
      id: 'delta-12',
      elementId: 'el-2',
      elementType: 'container',
      attribute: 'plannedEnd',
      value: '2029-12-31',
      previousDeltaId: 'delta-11',
      sourceId: 'src-1',
      confidence: 0.6,
    };
    expect(fromDeltaRow(toDeltaRow(create, ctx))).toEqual(create);
    expect(fromDeltaRow(toDeltaRow(update, ctx))).toEqual(update);
  });
});

describe('System criticality, hostingModel and hostingProvider (Prompt 7k item 1)', () => {
  it('are accepted at create, all optional, and survive the row round trip', () => {
    const d: Delta = {
      kind: 'element.create',
      id: 'delta-13',
      elementId: 'el-3',
      elementType: 'system',
      name: 'Payments Gateway',
      parentId: null,
      attributes: { lifecycleStatus: 'active', isExternal: false, criticality: 'critical', hostingModel: 'saas', hostingProvider: 'Acme Cloud (eu-west-1)' },
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('can each be set later via an update, with none recorded at create', () => {
    const create: Delta = {
      kind: 'element.create',
      id: 'delta-14',
      elementId: 'el-4',
      elementType: 'system',
      name: 'Legacy Billing',
      parentId: null,
      attributes: { lifecycleStatus: 'active', isExternal: false },
      sourceId: 'src-1',
      confidence: 1,
    };
    const setCriticality: Delta = {
      kind: 'element.update',
      id: 'delta-15',
      elementId: 'el-4',
      elementType: 'system',
      attribute: 'criticality',
      value: 'high',
      previousDeltaId: 'delta-14',
      sourceId: 'src-1',
      confidence: 0.8,
    };
    const setHostingModel: Delta = {
      kind: 'element.update',
      id: 'delta-16',
      elementId: 'el-4',
      elementType: 'system',
      attribute: 'hostingModel',
      value: 'on_premises',
      previousDeltaId: 'delta-15',
      sourceId: 'src-1',
      confidence: 0.8,
    };
    expect(fromDeltaRow(toDeltaRow(create, ctx))).toEqual(create);
    expect(fromDeltaRow(toDeltaRow(setCriticality, ctx))).toEqual(setCriticality);
    expect(fromDeltaRow(toDeltaRow(setHostingModel, ctx))).toEqual(setHostingModel);
  });
});

describe('System domain (Prompt 7k item 3)', () => {
  it('is accepted at create, optional, and survives the row round trip', () => {
    const d: Delta = {
      kind: 'element.create',
      id: 'delta-17',
      elementId: 'el-5',
      elementType: 'system',
      name: 'PLC Controller',
      parentId: null,
      attributes: { lifecycleStatus: 'active', isExternal: false, domain: 'ot' },
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('can be set later via an update', () => {
    const setDomain: Delta = {
      kind: 'element.update',
      id: 'delta-18',
      elementId: 'el-5',
      elementType: 'system',
      attribute: 'domain',
      value: 'hybrid',
      previousDeltaId: 'delta-17',
      sourceId: 'src-1',
      confidence: 0.8,
    };
    expect(fromDeltaRow(toDeltaRow(setDomain, ctx))).toEqual(setDomain);
  });
});

describe('System kind and relationship via (Prompt 7k item 4)', () => {
  it('kind is accepted at create, optional, and survives the row round trip', () => {
    const d: Delta = {
      kind: 'element.create',
      id: 'delta-19',
      elementId: 'el-6',
      elementType: 'system',
      name: 'Enterprise Service Bus',
      parentId: null,
      attributes: { lifecycleStatus: 'active', isExternal: false, kind: 'integration_platform' },
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('kind can be set later via an update', () => {
    const setKind: Delta = {
      kind: 'element.update',
      id: 'delta-20',
      elementId: 'el-6',
      elementType: 'system',
      attribute: 'kind',
      value: 'data_platform',
      previousDeltaId: 'delta-19',
      sourceId: 'src-1',
      confidence: 0.8,
    };
    expect(fromDeltaRow(toDeltaRow(setKind, ctx))).toEqual(setKind);
  });

  it('flows_to.via is accepted at create, optional, and survives the row round trip', () => {
    const d: Delta = {
      kind: 'relationship.create',
      id: 'delta-21',
      relationshipId: 'rel-1',
      relationshipType: 'flows_to',
      fromElementId: 'el-a',
      toElementId: 'el-b',
      attributes: { description: 'sends readings via', via: 'el-6' },
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('uses.via can be set later via an update, with none recorded at create', () => {
    const create: Delta = {
      kind: 'relationship.create',
      id: 'delta-22',
      relationshipId: 'rel-2',
      relationshipType: 'uses',
      fromElementId: 'el-a',
      toElementId: 'el-b',
      attributes: { description: 'polls' },
      sourceId: 'src-1',
      confidence: 1,
    };
    const setVia: Delta = {
      kind: 'relationship.update',
      id: 'delta-23',
      relationshipId: 'rel-2',
      relationshipType: 'uses',
      attribute: 'via',
      value: 'el-6',
      previousDeltaId: 'delta-22',
      sourceId: 'src-1',
      confidence: 0.9,
    };
    expect(fromDeltaRow(toDeltaRow(create, ctx))).toEqual(create);
    expect(fromDeltaRow(toDeltaRow(setVia, ctx))).toEqual(setVia);
  });
});

describe('Capability essentialFunction and system supportEndsAt (Prompt 7k item 5)', () => {
  it('essentialFunction is accepted at create, optional, and survives the row round trip', () => {
    const d: Delta = {
      kind: 'element.create',
      id: 'delta-24',
      elementId: 'el-7',
      elementType: 'capability',
      name: 'Water Treatment',
      parentId: null,
      attributes: { essentialFunction: true },
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('essentialFunction can be set later via an update, with none recorded at create', () => {
    const create: Delta = {
      kind: 'element.create',
      id: 'delta-25',
      elementId: 'el-8',
      elementType: 'capability',
      name: 'Meter Reading',
      parentId: null,
      attributes: {},
      sourceId: 'src-1',
      confidence: 1,
    };
    const setEssential: Delta = {
      kind: 'element.update',
      id: 'delta-26',
      elementId: 'el-8',
      elementType: 'capability',
      attribute: 'essentialFunction',
      value: true,
      previousDeltaId: 'delta-25',
      sourceId: 'src-1',
      confidence: 0.9,
    };
    expect(fromDeltaRow(toDeltaRow(create, ctx))).toEqual(create);
    expect(fromDeltaRow(toDeltaRow(setEssential, ctx))).toEqual(setEssential);
  });

  it('supportEndsAt is accepted at create, optional, and survives the row round trip', () => {
    const d: Delta = {
      kind: 'element.create',
      id: 'delta-27',
      elementId: 'el-9',
      elementType: 'system',
      name: 'SCADA Historian',
      parentId: null,
      attributes: { lifecycleStatus: 'active', isExternal: false, criticality: 'critical', supportEndsAt: '2026-12-31' },
      sourceId: 'src-1',
      confidence: 1,
    };
    expect(fromDeltaRow(toDeltaRow(d, ctx))).toEqual(d);
  });

  it('supportEndsAt can be set later via an update, distinct from plannedEnd', () => {
    const create: Delta = {
      kind: 'element.create',
      id: 'delta-28',
      elementId: 'el-10',
      elementType: 'system',
      name: 'Billing Mainframe',
      parentId: null,
      attributes: { lifecycleStatus: 'active', isExternal: false, plannedEnd: '2030-01-01' },
      sourceId: 'src-1',
      confidence: 1,
    };
    const setSupportEndsAt: Delta = {
      kind: 'element.update',
      id: 'delta-29',
      elementId: 'el-10',
      elementType: 'system',
      attribute: 'supportEndsAt',
      value: '2027-06-30',
      previousDeltaId: 'delta-28',
      sourceId: 'src-1',
      confidence: 0.8,
    };
    expect(fromDeltaRow(toDeltaRow(create, ctx))).toEqual(create);
    expect(fromDeltaRow(toDeltaRow(setSupportEndsAt, ctx))).toEqual(setSupportEndsAt);
  });
});
