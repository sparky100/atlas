import { describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { emptyHead, type ElementRow, type RelationshipRow } from '../engine/deltas';
import { groupCaptureDraftOverlaps, summarizeOwnDeltas, touchedElementIds } from './changeSummary';
import type { BranchRow } from './types';

function elementCreate(id: string, elementId: string, name: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 'src', confidence: 1 };
}

function elementUpdate(id: string, elementId: string, value: string, previousDeltaId: string): Delta {
  return { kind: 'element.update', id, elementId, elementType: 'system', attribute: 'name', value, previousDeltaId, sourceId: 'src', confidence: 1 };
}

function relationshipCreate(id: string, relationshipId: string, fromElementId: string, toElementId: string): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType: 'supports', fromElementId, toElementId, attributes: { role: 'secondary' }, sourceId: 'src', confidence: 1 };
}

function system(name: string): ElementRow {
  return { elementType: 'system', name, parentId: null, attributes: {}, existsDeltaId: `create-${name}` };
}

function capability(name: string): ElementRow {
  return { elementType: 'capability', name, parentId: null, attributes: {}, existsDeltaId: `create-${name}` };
}

function supports(fromElementId: string, toElementId: string): RelationshipRow {
  return { relationshipType: 'supports', fromElementId, toElementId, attributes: {}, existsDeltaId: 'create-supports' };
}

function valueStream(name: string, parentId: string | null): ElementRow {
  return { elementType: 'value_stream', name, parentId, attributes: {}, existsDeltaId: `create-${name}` };
}

function enables(fromElementId: string, toElementId: string): RelationshipRow {
  return { relationshipType: 'enables', fromElementId, toElementId, attributes: {}, existsDeltaId: 'create-enables' };
}

describe('summarizeOwnDeltas', () => {
  it('groups a subject\'s own deltas together, named from the to-be side', () => {
    const asIs = emptyHead();
    asIs.elements.set('sys-1', system('Old Name'));

    const toBe = emptyHead();
    toBe.elements.set('sys-1', system('New Name'));

    const deltas = [elementUpdate('d1', 'sys-1', 'New Name', 'create-1')];
    const result = summarizeOwnDeltas(deltas, asIs, toBe);

    expect(result.subjects).toHaveLength(1);
    expect(result.subjects[0]).toMatchObject({ subjectId: 'sys-1', subjectType: 'element', name: 'New Name', deltas });
  });

  it('falls back to the as-is name for a subject this branch retracted (gone from to-be)', () => {
    const asIs = emptyHead();
    asIs.elements.set('sys-1', system('Retiring System'));
    const toBe = emptyHead(); // retracted — not present

    const deltas: Delta[] = [{ kind: 'element.retract', id: 'd1', elementId: 'sys-1', elementType: 'system', previousDeltaId: 'create-1', sourceId: 'src', confidence: 1 }];
    const result = summarizeOwnDeltas(deltas, asIs, toBe);

    expect(result.subjects[0]?.name).toBe('Retiring System');
  });

  it('names a relationship subject "type A → B", resolving both endpoints', () => {
    const asIs = emptyHead();
    const toBe = emptyHead();
    toBe.elements.set('sys-a', system('Alpha'));
    toBe.elements.set('cap-1', capability('Housing'));
    toBe.relationships.set('rel-1', supports('sys-a', 'cap-1'));

    const deltas = [relationshipCreate('d1', 'rel-1', 'sys-a', 'cap-1')];
    const result = summarizeOwnDeltas(deltas, asIs, toBe);

    expect(result.subjects[0]).toMatchObject({ subjectId: 'rel-1', subjectType: 'relationship', name: 'supports Alpha → Housing' });
  });

  it('finds affected capabilities via a touched system\'s own supports edge, even when the capability itself has no delta', () => {
    const asIs = emptyHead();
    asIs.elements.set('sys-a', system('Alpha'));

    const toBe = emptyHead();
    toBe.elements.set('sys-a', system('Alpha Renamed'));
    toBe.elements.set('cap-1', capability('Housing')); // pre-existing, no delta from this branch
    toBe.relationships.set('rel-1', supports('sys-a', 'cap-1'));

    const deltas = [elementUpdate('d1', 'sys-a', 'Alpha Renamed', 'create-1')];
    const result = summarizeOwnDeltas(deltas, asIs, toBe);

    expect(result.affectedCapabilities).toHaveLength(1);
    expect(result.affectedCapabilities[0]).toMatchObject({ capability: { element_id: 'cap-1', name: 'Housing' } });
    expect(result.affectedCapabilities[0]?.viaSystems.map((s) => s.element_id)).toEqual(['sys-a']);
  });

  it('includes a directly-touched capability with no supporting system in scope', () => {
    const asIs = emptyHead();
    const toBe = emptyHead();
    toBe.elements.set('cap-1', capability('New Capability'));

    const deltas = [elementCreate('d1', 'cap-1', 'New Capability')];
    const result = summarizeOwnDeltas(deltas, asIs, toBe);

    expect(result.affectedCapabilities).toMatchObject([{ capability: { element_id: 'cap-1' }, viaSystems: [] }]);
  });

  it('ignores a supports edge from an untouched system', () => {
    const asIs = emptyHead();
    const toBe = emptyHead();
    toBe.elements.set('sys-untouched', system('Untouched'));
    toBe.elements.set('cap-1', capability('Housing'));
    toBe.relationships.set('rel-1', supports('sys-untouched', 'cap-1'));
    toBe.elements.set('sys-b', system('Beta'));

    // Only sys-b has a delta — the supports edge from sys-untouched doesn't count.
    const deltas = [elementCreate('d1', 'sys-b', 'Beta')];
    const result = summarizeOwnDeltas(deltas, asIs, toBe);

    expect(result.affectedCapabilities).toHaveLength(0);
  });

  it('F6 (ADR-023): finds affected value streams via an affected capability\'s own enables edge onto a stage', () => {
    const asIs = emptyHead();
    asIs.elements.set('sys-a', system('Alpha'));

    const toBe = emptyHead();
    toBe.elements.set('sys-a', system('Alpha Renamed'));
    toBe.elements.set('cap-1', capability('Housing'));
    toBe.relationships.set('rel-1', supports('sys-a', 'cap-1'));
    toBe.elements.set('vs-1', valueStream('Getting Connected', null));
    toBe.elements.set('st-1', valueStream('Apply', 'vs-1'));
    toBe.relationships.set('rel-2', enables('cap-1', 'st-1'));

    const deltas = [elementUpdate('d1', 'sys-a', 'Alpha Renamed', 'create-1')];
    const result = summarizeOwnDeltas(deltas, asIs, toBe);

    expect(result.affectedValueStreams).toHaveLength(1);
    expect(result.affectedValueStreams[0]).toMatchObject({ stream: { element_id: 'vs-1', name: 'Getting Connected' } });
    expect(result.affectedValueStreams[0]?.stages).toMatchObject([{ stage: { element_id: 'st-1' }, viaCapabilities: [{ element_id: 'cap-1' }] }]);
  });

  it('F6 (ADR-023): ignores an enables edge from a capability this change never reaches', () => {
    const asIs = emptyHead();
    const toBe = emptyHead();
    toBe.elements.set('cap-unreached', capability('Unreached'));
    toBe.elements.set('vs-1', valueStream('Getting Connected', null));
    toBe.elements.set('st-1', valueStream('Apply', 'vs-1'));
    toBe.relationships.set('rel-1', enables('cap-unreached', 'st-1'));
    toBe.elements.set('sys-b', system('Beta'));

    const deltas = [elementCreate('d1', 'sys-b', 'Beta')];
    const result = summarizeOwnDeltas(deltas, asIs, toBe);

    expect(result.affectedValueStreams).toHaveLength(0);
  });

  describe("ADR-024 amendment: which systems a change touches, and why", () => {
    function container(name: string, parentId: string): ElementRow {
      return { elementType: 'container', name, parentId, attributes: {}, existsDeltaId: `create-${name}` };
    }
    function platform(name: string): ElementRow {
      return { elementType: 'system', name, parentId: null, attributes: { kind: 'platform' }, existsDeltaId: `create-${name}` };
    }
    function edge(relationshipType: 'uses' | 'flows_to', fromElementId: string, toElementId: string): RelationshipRow {
      return { relationshipType, fromElementId, toElementId, attributes: {}, existsDeltaId: `create-${relationshipType}` };
    }
    function edgeCreate(id: string, relationshipId: string, relationshipType: 'uses' | 'flows_to', fromElementId: string, toElementId: string): Delta {
      return { kind: 'relationship.create', id, relationshipId, relationshipType, fromElementId, toElementId, attributes: {}, sourceId: 'src', confidence: 1 };
    }

    /** ESCOMS supports Wayleaves; GIS supports two other capabilities. */
    function escomsAndGis() {
      const asIs = emptyHead();
      const toBe = emptyHead();
      for (const head of [asIs, toBe]) {
        head.elements.set('escoms', system('ESCOMS'));
        head.elements.set('gis', system('GIS'));
        head.elements.set('cap-wayleaves', capability('Wayleaves'));
        head.elements.set('cap-mapping', capability('Network mapping'));
        head.elements.set('cap-fault', capability('Fault location'));
        head.relationships.set('s1', supports('escoms', 'cap-wayleaves'));
        head.relationships.set('s2', supports('gis', 'cap-mapping'));
        head.relationships.set('s3', supports('gis', 'cap-fault'));
      }
      return { asIs, toBe };
    }

    it("a new integration counts only its consuming side: ESCOMS uses GIS reaches Wayleaves, nothing GIS supports", () => {
      const { asIs, toBe } = escomsAndGis();
      toBe.relationships.set('rel-int', edge('uses', 'escoms', 'gis'));

      const result = summarizeOwnDeltas([edgeCreate('d1', 'rel-int', 'uses', 'escoms', 'gis')], asIs, toBe);

      expect(result.affectedCapabilities.map((ac) => ac.capability.name)).toEqual(['Wayleaves']);
      expect(result.affectedCapabilities[0]?.reasons).toEqual([{ kind: 'integration', systemName: 'ESCOMS', consumerName: 'ESCOMS', relationshipType: 'uses', otherName: 'GIS' }]);
      expect(result.affectedCapabilities[0]?.viaSystems.map((s) => s.element_id)).toEqual(['escoms']);
    });

    it('a flows_to edge counts its sending side', () => {
      const { asIs, toBe } = escomsAndGis();
      toBe.relationships.set('rel-flow', edge('flows_to', 'gis', 'escoms'));

      const result = summarizeOwnDeltas([edgeCreate('d1', 'rel-flow', 'flows_to', 'gis', 'escoms')], asIs, toBe);

      expect(result.affectedCapabilities.map((ac) => ac.capability.name)).toEqual(['Fault location', 'Network mapping']);
    });

    it('a removed integration still counts — read from the as-is side', () => {
      const { asIs, toBe } = escomsAndGis();
      asIs.relationships.set('rel-int', edge('uses', 'escoms', 'gis'));
      const retract: Delta = { kind: 'relationship.retract', id: 'd1', relationshipId: 'rel-int', relationshipType: 'uses', previousDeltaId: 'create-uses', sourceId: 'src', confidence: 1 };

      const result = summarizeOwnDeltas([retract], asIs, toBe);

      expect(result.affectedCapabilities.map((ac) => ac.capability.name)).toEqual(['Wayleaves']);
    });

    it("a module's edit and a module's integration both roll up to its platform, named \"Platform · Module\"", () => {
      const { asIs, toBe } = escomsAndGis();
      for (const head of [asIs, toBe]) {
        head.elements.set('sap', platform('SAP'));
        head.elements.set('pm', container('PM', 'sap'));
        head.elements.set('cap-maint', capability('Maintenance'));
        head.relationships.set('s4', supports('sap', 'cap-maint'));
      }
      toBe.relationships.set('rel-int', edge('uses', 'pm', 'gis'));
      const moduleEdit: Delta = { kind: 'element.update', id: 'd1', elementId: 'pm', elementType: 'container', attribute: 'description', value: 'x', previousDeltaId: 'create-PM', sourceId: 'src', confidence: 1 };

      const result = summarizeOwnDeltas([moduleEdit, edgeCreate('d2', 'rel-int', 'uses', 'pm', 'gis')], asIs, toBe);

      expect(result.affectedCapabilities.map((ac) => ac.capability.name)).toEqual(['Maintenance']);
      expect(result.affectedCapabilities[0]?.reasons).toEqual([
        { kind: 'module', systemName: 'SAP', moduleName: 'SAP · PM' },
        { kind: 'integration', systemName: 'SAP', consumerName: 'SAP · PM', relationshipType: 'uses', otherName: 'GIS' },
      ]);
    });

    it("a module's own supports edge counts when the module is touched — ESCOMS as a module of Salesforce, supporting Wayleaves itself", () => {
      const asIs = emptyHead();
      const toBe = emptyHead();
      for (const head of [asIs, toBe]) {
        head.elements.set('salesforce', platform('Salesforce'));
        head.elements.set('escoms', container('ESCOMS', 'salesforce'));
        head.elements.set('arcgis', platform('ArcGIS'));
        head.elements.set('enterprise', container('Enterprise', 'arcgis'));
        head.elements.set('cap-wayleaves', capability('Land, Wayleaves & Consents'));
        head.elements.set('cap-gis', capability('Network mapping'));
        head.relationships.set('s1', supports('escoms', 'cap-wayleaves'));
        head.relationships.set('s2', supports('enterprise', 'cap-gis'));
      }
      toBe.relationships.set('rel-int', edge('uses', 'escoms', 'enterprise'));

      const result = summarizeOwnDeltas([edgeCreate('d1', 'rel-int', 'uses', 'escoms', 'enterprise')], asIs, toBe);

      expect(result.affectedCapabilities.map((ac) => ac.capability.name)).toEqual(['Land, Wayleaves & Consents']);
      expect(result.affectedCapabilities[0]?.reasons).toEqual([{ kind: 'integration', systemName: 'Salesforce', consumerName: 'Salesforce · ESCOMS', relationshipType: 'uses', otherName: 'ArcGIS · Enterprise' }]);
    });

    it('names a relationship created and retracted on the same change from its own create delta, not its raw id', () => {
      const { asIs, toBe } = escomsAndGis();
      const create = edgeCreate('d1', 'rel-gone', 'uses', 'escoms', 'gis');
      const retract: Delta = { kind: 'relationship.retract', id: 'd2', relationshipId: 'rel-gone', relationshipType: 'uses', previousDeltaId: 'd1', sourceId: 'src', confidence: 1 };

      const result = summarizeOwnDeltas([create, retract], asIs, toBe);

      expect(result.subjects[0]?.name).toBe('uses ESCOMS → GIS');
    });

    it('names an element created and retracted on the same change from its own create delta, not its raw id', () => {
      const { asIs, toBe } = escomsAndGis();
      const create: Delta = { kind: 'element.create', id: 'd1', elementId: 'el-gone', elementType: 'system', name: 'New Quote Tool', parentId: null, attributes: {}, sourceId: 'src', confidence: 1 } as Delta;
      const retract: Delta = { kind: 'element.retract', id: 'd2', elementId: 'el-gone', previousDeltaId: 'd1', sourceId: 'src', confidence: 1 } as Delta;

      const result = summarizeOwnDeltas([create, retract], asIs, toBe);

      expect(result.subjects[0]?.name).toBe('New Quote Tool');
    });

    it('a supports edge of its own names its capability, without reaching the system\'s other capabilities', () => {
      const { asIs, toBe } = escomsAndGis();
      toBe.relationships.set('s-new', supports('gis', 'cap-wayleaves'));

      const result = summarizeOwnDeltas([relationshipCreate('d1', 's-new', 'gis', 'cap-wayleaves')], asIs, toBe);

      expect(result.affectedCapabilities.map((ac) => ac.capability.name)).toEqual(['Wayleaves']);
      expect(result.affectedCapabilities[0]?.reasons).toEqual([{ kind: 'supports', systemName: 'GIS' }]);
    });

    it('a system edited directly still reaches everything it supports, with an "edited" reason', () => {
      const { asIs, toBe } = escomsAndGis();
      const result = summarizeOwnDeltas([elementUpdate('d1', 'gis', 'GIS', 'create-GIS')], asIs, toBe);

      expect(result.affectedCapabilities.map((ac) => ac.capability.name)).toEqual(['Fault location', 'Network mapping']);
      expect(result.affectedCapabilities.every((ac) => ac.reasons.every((r) => r.kind === 'edited'))).toBe(true);
    });
  });
});

describe("ADR-023 amendment: value streams a change names directly", () => {
  function enablesCreate(id: string, relationshipId: string, from: string, to: string): Delta {
    return { kind: 'relationship.create', id, relationshipId, relationshipType: 'enables', fromElementId: from, toElementId: to, attributes: {}, sourceId: 'src', confidence: 1 };
  }
  function streamHeads() {
    const asIs = emptyHead();
    const toBe = emptyHead();
    for (const head of [asIs, toBe]) {
      head.elements.set('cap-w', capability('Wayleaves'));
      head.elements.set('vs', valueStream('Connections', null));
      head.elements.set('st-survey', valueStream('Survey', 'vs'));
    }
    return { asIs, toBe };
  }

  it('an enables edge added on its own names its stage, though no capability is affected', () => {
    const { asIs, toBe } = streamHeads();
    toBe.relationships.set('en-1', enables('cap-w', 'st-survey'));

    const result = summarizeOwnDeltas([enablesCreate('d1', 'en-1', 'cap-w', 'st-survey')], asIs, toBe);

    expect(result.affectedCapabilities).toEqual([]);
    expect(result.affectedValueStreams).toMatchObject([{ stream: { name: 'Connections' }, reasons: [], stages: [{ stage: { name: 'Survey' }, viaCapabilities: [], reasons: [{ kind: 'enables', capabilityName: 'Wayleaves', change: 'added' }] }] }]);
  });

  it('a removed enables edge still names its stage — read from the as-is head', () => {
    const { asIs, toBe } = streamHeads();
    asIs.relationships.set('en-1', enables('cap-w', 'st-survey'));
    const retract: Delta = { kind: 'relationship.retract', id: 'd1', relationshipId: 'en-1', relationshipType: 'enables', previousDeltaId: 'create-enables', sourceId: 'src', confidence: 1 };

    const result = summarizeOwnDeltas([retract], asIs, toBe);

    expect(result.affectedValueStreams[0]?.stages[0]?.reasons).toEqual([{ kind: 'enables', capabilityName: 'Wayleaves', change: 'removed' }]);
  });

  it("a stage or stream edited directly counts; a stage removed is named from the as-is head", () => {
    const { asIs, toBe } = streamHeads();
    toBe.elements.delete('st-survey');
    const deltas: Delta[] = [
      { kind: 'element.update', id: 'd1', elementId: 'vs', elementType: 'value_stream', attribute: 'name', value: 'Connections', previousDeltaId: 'create-Connections', sourceId: 'src', confidence: 1 },
      { kind: 'element.retract', id: 'd2', elementId: 'st-survey', elementType: 'value_stream', previousDeltaId: 'create-Survey', sourceId: 'src', confidence: 1 },
    ];

    const result = summarizeOwnDeltas(deltas, asIs, toBe);

    expect(result.affectedValueStreams).toMatchObject([{ stream: { name: 'Connections' }, reasons: [{ kind: 'stream', change: 'edited' }], stages: [{ stage: { name: 'Survey' }, reasons: [{ kind: 'stage', change: 'removed' }] }] }]);
  });

  it('an enables edge created and removed on the same change counts for nothing', () => {
    const { asIs, toBe } = streamHeads();
    const deltas: Delta[] = [
      enablesCreate('d1', 'en-1', 'cap-w', 'st-survey'),
      { kind: 'relationship.retract', id: 'd2', relationshipId: 'en-1', relationshipType: 'enables', previousDeltaId: 'd1', sourceId: 'src', confidence: 1 },
    ];
    expect(summarizeOwnDeltas(deltas, asIs, toBe).affectedValueStreams).toEqual([]);
  });
});

describe('touchedElementIds (ADR-024 §9)', () => {
  it('counts each element edited and both ends of each relationship edit, even one created and removed again', () => {
    const asIs = emptyHead();
    asIs.elements.set('escoms', system('ESCOMS'));
    asIs.elements.set('enterprise', system('Enterprise'));
    asIs.relationships.set('rel-old', supports('escoms', 'cap'));
    const toBe = emptyHead();
    toBe.elements.set('escoms', system('ESCOMS'));
    toBe.elements.set('enterprise', system('Enterprise'));
    toBe.elements.set('tableau', system('Tableau'));

    const deltas: Delta[] = [
      elementCreate('d1', 'tableau', 'Tableau'),
      { kind: 'relationship.create', id: 'd2', relationshipId: 'rel-gone', relationshipType: 'uses', fromElementId: 'escoms', toElementId: 'enterprise', attributes: {}, sourceId: 'src', confidence: 1 },
      { kind: 'relationship.retract', id: 'd3', relationshipId: 'rel-gone', relationshipType: 'uses', previousDeltaId: 'd2', sourceId: 'src', confidence: 1 },
      { kind: 'relationship.retract', id: 'd4', relationshipId: 'rel-old', relationshipType: 'supports', previousDeltaId: 'create-supports', sourceId: 'src', confidence: 1 },
    ];

    expect([...touchedElementIds(deltas, asIs, toBe)].sort()).toEqual(['cap', 'enterprise', 'escoms', 'tableau']);
  });
});

describe('groupCaptureDraftOverlaps (ADR-024 §9)', () => {
  const draft = (id: string, title: string) => ({ id, name: `capture/${id}`, title, kind: 'capture_draft', status: 'draft' }) as unknown as BranchRow;

  it('groups re-uploads of one document, counts them, unions what they share, and links the newest job', () => {
    const groups = groupCaptureDraftOverlaps(
      [
        { branch: draft('b1', 'SPDJune2026ActionPlan.pdf — 2026-09-24'), sharedElementNames: ['Salesforce · ESCOMS'] },
        { branch: draft('b2', 'SPDJune2026ActionPlan.pdf — 2026-09-24'), sharedElementNames: ['Salesforce', 'Salesforce · ESCOMS'] },
        { branch: draft('b3', 'Digitalisation.pdf — 2026-09-21'), sharedElementNames: ['Salesforce'] },
      ],
      new Map([
        ['b1', { id: 'job-old', createdAt: '2026-09-24T10:00:00Z' }],
        ['b2', { id: 'job-new', createdAt: '2026-09-25T10:00:00Z' }],
        ['b3', { id: 'job-3', createdAt: '2026-09-21T10:00:00Z' }],
      ]),
    );

    expect(groups).toEqual([
      { title: 'Digitalisation.pdf — 2026-09-21', draftCount: 1, latestJobId: 'job-3', sharedElementNames: ['Salesforce'] },
      { title: 'SPDJune2026ActionPlan.pdf — 2026-09-24', draftCount: 2, latestJobId: 'job-new', sharedElementNames: ['Salesforce', 'Salesforce · ESCOMS'] },
    ]);
  });

  it('still lists a draft whose job row is missing, with no review link', () => {
    expect(groupCaptureDraftOverlaps([{ branch: draft('b1', 'Orphan.pdf'), sharedElementNames: ['GIS'] }], new Map())).toEqual([{ title: 'Orphan.pdf', draftCount: 1, latestJobId: null, sharedElementNames: ['GIS'] }]);
  });

  describe('names a module "Platform · Module" in the edit list, as everywhere else', () => {
    const sap: ElementRow = { elementType: 'system', name: 'SAP', parentId: null, attributes: { kind: 'platform' }, existsDeltaId: 'c-sap' };
    const salesforce: ElementRow = { elementType: 'system', name: 'Salesforce', parentId: null, attributes: { kind: 'platform' }, existsDeltaId: 'c-sf' };
    const pm: ElementRow = { elementType: 'container', name: 'PM', parentId: 'sap', attributes: {}, existsDeltaId: 'c-pm' };
    const escoms: ElementRow = { elementType: 'container', name: 'ESCOMS', parentId: 'sf', attributes: {}, existsDeltaId: 'c-esc' };
    const rel: RelationshipRow = { relationshipType: 'uses', fromElementId: 'escoms', toElementId: 'pm', attributes: {}, existsDeltaId: 'c-rel' };

    it('writes both ends of a relationship, and a module element itself, with their platform', () => {
      const asIs = emptyHead();
      const toBe = emptyHead();
      for (const [id, row] of [['sap', sap], ['sf', salesforce], ['pm', pm], ['escoms', escoms]] as const) toBe.elements.set(id, row);
      toBe.relationships.set('rel-1', rel);
      const deltas: Delta[] = [
        { kind: 'relationship.create', id: 'd1', relationshipId: 'rel-1', relationshipType: 'uses', fromElementId: 'escoms', toElementId: 'pm', attributes: {}, sourceId: 'src', confidence: 1 },
        elementCreate('d2', 'pm', 'PM'),
      ];
      const result = summarizeOwnDeltas(deltas, asIs, toBe);
      expect(result.subjects.find((s) => s.subjectId === 'rel-1')?.name).toBe('uses Salesforce · ESCOMS → SAP · PM');
      expect(result.subjects.find((s) => s.subjectId === 'pm')?.name).toBe('SAP · PM');
    });

    it('still writes a plain system by its own name, and an id only for an element neither head knows', () => {
      const asIs = emptyHead();
      const toBe = emptyHead();
      toBe.elements.set('sap', sap);
      const result = summarizeOwnDeltas([elementCreate('d1', 'sap', 'SAP')], asIs, toBe);
      expect(result.subjects[0]?.name).toBe('SAP');
    });
  });
});
