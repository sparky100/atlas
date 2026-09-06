/**
 * RT-1-style property tests (SPEC-data-model.md §10.1): for every DeltaKind,
 * an arbitrary Delta survives a JSON round trip and a storage-row round
 * trip. This is the contract-level rehearsal of RT-1; the full RT-1
 * (`deltas` row → `Delta` via a real Postgres insert/select) needs src/db
 * and lands with it.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ELEMENT_TYPES,
  RELATIONSHIP_TYPES,
  type ActorAttributes,
  type CapabilityAttributes,
  type ComponentAttributes,
  type ContainerAttributes,
  type Delta,
  type DataClassification,
  type DeltaKind,
  type FlowsToAttributes,
  type LifecycleStatus,
  type OwnsAttributes,
  type SupportsAttributes,
  type SystemAttributes,
  type UsesAttributes,
  factKeyOf,
  subjectOf,
} from './delta';
import { envelopeToDeltaRows, fromCommitRow, fromDeltaRow, toCommitRow, toDeltaRow } from './rows';
import type { CommitEnvelope } from './delta';

const uuid = fc.uuid();
const isoDate = fc
  .date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2026-01-01T00:00:00Z'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));
const confidence = fc.float({ min: 0, max: 1, noNaN: true }).map((n) => Math.round(n * 100) / 100);

/** The base fields every delta carries, with sourceRef/effectiveDate genuinely absent sometimes (not present-as-undefined) — matches exactOptionalPropertyTypes. */
const provenanceBase = fc.record(
  { id: uuid, sourceId: uuid, sourceRef: fc.string({ minLength: 1, maxLength: 24 }), effectiveDate: isoDate, confidence },
  { requiredKeys: ['id', 'sourceId', 'confidence'] },
);

const lifecycleStatus: LifecycleStatus[] = ['planned', 'active', 'retiring', 'retired'];
const dataClassification: DataClassification[] = ['public', 'official', 'official_sensitive', 'special_category'];

const capabilityAttributes: fc.Arbitrary<CapabilityAttributes> = fc.record(
  { description: fc.string(), code: fc.string({ minLength: 1, maxLength: 6 }) },
  { requiredKeys: [] },
);
const systemAttributes: fc.Arbitrary<SystemAttributes> = fc.record(
  {
    description: fc.string(),
    lifecycleStatus: fc.constantFrom(...lifecycleStatus),
    vendor: fc.string(),
    isExternal: fc.boolean(),
    externalOrganisation: fc.string(),
    introduced: isoDate,
    plannedEnd: isoDate,
  },
  { requiredKeys: ['lifecycleStatus', 'isExternal'] },
);
const containerAttributes: fc.Arbitrary<ContainerAttributes> = fc.record(
  { description: fc.string(), technology: fc.string(), isExternal: fc.boolean(), introduced: isoDate, plannedEnd: isoDate },
  { requiredKeys: ['isExternal'] },
);
const componentAttributes: fc.Arbitrary<ComponentAttributes> = fc.record({ description: fc.string(), technology: fc.string() }, { requiredKeys: [] });
const actorAttributes: fc.Arbitrary<ActorAttributes> = fc.record(
  { subtype: fc.constantFrom('person' as const, 'team' as const), email: fc.string(), orgUnit: fc.string(), isExternal: fc.boolean(), externalOrganisation: fc.string() },
  { requiredKeys: ['subtype', 'isExternal'] },
);

const supportsAttributes: fc.Arbitrary<SupportsAttributes> = fc.record({ description: fc.string() }, { requiredKeys: [] });
const usesAttributes: fc.Arbitrary<UsesAttributes> = fc.record({ description: fc.string() }, { requiredKeys: [] });
const ownsAttributes: fc.Arbitrary<OwnsAttributes> = fc.record({ primary: fc.boolean() }, { requiredKeys: ['primary'] });
const flowsToAttributes: fc.Arbitrary<FlowsToAttributes> = fc.record(
  { description: fc.string(), dataClassification: fc.constantFrom(...dataClassification), protocol: fc.string() },
  { requiredKeys: [] },
);

/** One arbitrary per ElementType's `element.create`, unioned. */
const elementCreateArb: fc.Arbitrary<Delta> = fc.oneof(
  fc.tuple(provenanceBase, uuid, fc.string({ minLength: 1, maxLength: 40 }), fc.option(uuid, { nil: null }), capabilityAttributes).map(
    ([base, elementId, name, parentId, attributes]) =>
      ({ ...base, kind: 'element.create', elementId, elementType: 'capability', name, parentId, attributes }) satisfies Delta,
  ),
  fc.tuple(provenanceBase, uuid, fc.string({ minLength: 1, maxLength: 40 }), fc.option(uuid, { nil: null }), systemAttributes).map(
    ([base, elementId, name, parentId, attributes]) =>
      ({ ...base, kind: 'element.create', elementId, elementType: 'system', name, parentId, attributes }) satisfies Delta,
  ),
  fc.tuple(provenanceBase, uuid, fc.string({ minLength: 1, maxLength: 40 }), uuid, containerAttributes).map(
    ([base, elementId, name, parentId, attributes]) =>
      ({ ...base, kind: 'element.create', elementId, elementType: 'container', name, parentId, attributes }) satisfies Delta,
  ),
  fc.tuple(provenanceBase, uuid, fc.string({ minLength: 1, maxLength: 40 }), uuid, componentAttributes).map(
    ([base, elementId, name, parentId, attributes]) =>
      ({ ...base, kind: 'element.create', elementId, elementType: 'component', name, parentId, attributes }) satisfies Delta,
  ),
  fc.tuple(provenanceBase, uuid, fc.string({ minLength: 1, maxLength: 40 }), fc.option(uuid, { nil: null }), actorAttributes).map(
    ([base, elementId, name, parentId, attributes]) =>
      ({ ...base, kind: 'element.create', elementId, elementType: 'actor', name, parentId, attributes }) satisfies Delta,
  ),
);

const elementUpdateArb: fc.Arbitrary<Delta> = fc.oneof(
  fc.tuple(provenanceBase, uuid, uuid, fc.string({ minLength: 1, maxLength: 40 })).map(
    ([base, elementId, previousDeltaId, value]) =>
      ({ ...base, kind: 'element.update', elementId, elementType: 'system', attribute: 'name', value, previousDeltaId }) satisfies Delta,
  ),
  fc.tuple(provenanceBase, uuid, uuid, fc.option(uuid, { nil: null })).map(
    ([base, elementId, previousDeltaId, value]) =>
      ({ ...base, kind: 'element.update', elementId, elementType: 'container', attribute: 'parentId', value, previousDeltaId }) satisfies Delta,
  ),
  fc.tuple(provenanceBase, uuid, uuid, fc.constantFrom(...lifecycleStatus, null)).map(
    ([base, elementId, previousDeltaId, value]) =>
      ({ ...base, kind: 'element.update', elementId, elementType: 'system', attribute: 'lifecycleStatus', value, previousDeltaId }) satisfies Delta,
  ),
  fc.tuple(provenanceBase, uuid, uuid, fc.constantFrom('introduced' as const, 'plannedEnd' as const), fc.option(isoDate, { nil: null })).map(
    ([base, elementId, previousDeltaId, attribute, value]) =>
      ({ ...base, kind: 'element.update', elementId, elementType: 'system', attribute, value, previousDeltaId }) satisfies Delta,
  ),
);

const elementRetractArb: fc.Arbitrary<Delta> = fc
  .tuple(provenanceBase, uuid, fc.constantFrom(...ELEMENT_TYPES), uuid)
  .map(([base, elementId, elementType, previousDeltaId]) => ({ ...base, kind: 'element.retract', elementId, elementType, previousDeltaId }) satisfies Delta);

const elementRestoreArb: fc.Arbitrary<Delta> = fc
  .tuple(provenanceBase, uuid, fc.constantFrom(...ELEMENT_TYPES), uuid)
  .map(([base, elementId, elementType, previousDeltaId]) => ({ ...base, kind: 'element.restore', elementId, elementType, previousDeltaId }) satisfies Delta);

const relationshipCreateArb: fc.Arbitrary<Delta> = fc.oneof(
  fc.tuple(provenanceBase, uuid, uuid, uuid, supportsAttributes).map(
    ([base, relationshipId, fromElementId, toElementId, attributes]) =>
      ({ ...base, kind: 'relationship.create', relationshipId, relationshipType: 'supports', fromElementId, toElementId, attributes }) satisfies Delta,
  ),
  fc.tuple(provenanceBase, uuid, uuid, uuid, usesAttributes).map(
    ([base, relationshipId, fromElementId, toElementId, attributes]) =>
      ({ ...base, kind: 'relationship.create', relationshipId, relationshipType: 'uses', fromElementId, toElementId, attributes }) satisfies Delta,
  ),
  fc.tuple(provenanceBase, uuid, uuid, uuid, ownsAttributes).map(
    ([base, relationshipId, fromElementId, toElementId, attributes]) =>
      ({ ...base, kind: 'relationship.create', relationshipId, relationshipType: 'owns', fromElementId, toElementId, attributes }) satisfies Delta,
  ),
  fc.tuple(provenanceBase, uuid, uuid, uuid, flowsToAttributes).map(
    ([base, relationshipId, fromElementId, toElementId, attributes]) =>
      ({ ...base, kind: 'relationship.create', relationshipId, relationshipType: 'flows_to', fromElementId, toElementId, attributes }) satisfies Delta,
  ),
);

const relationshipUpdateArb: fc.Arbitrary<Delta> = fc.tuple(provenanceBase, uuid, uuid, fc.boolean()).map(
  ([base, relationshipId, previousDeltaId, value]) =>
    ({ ...base, kind: 'relationship.update', relationshipId, relationshipType: 'owns', attribute: 'primary', value, previousDeltaId }) satisfies Delta,
);

const relationshipRetractArb: fc.Arbitrary<Delta> = fc
  .tuple(provenanceBase, uuid, fc.constantFrom(...RELATIONSHIP_TYPES), uuid)
  .map(([base, relationshipId, relationshipType, previousDeltaId]) => ({ ...base, kind: 'relationship.retract', relationshipId, relationshipType, previousDeltaId }) satisfies Delta);

const relationshipRestoreArb: fc.Arbitrary<Delta> = fc
  .tuple(provenanceBase, uuid, fc.constantFrom(...RELATIONSHIP_TYPES), uuid)
  .map(([base, relationshipId, relationshipType, previousDeltaId]) => ({ ...base, kind: 'relationship.restore', relationshipId, relationshipType, previousDeltaId }) satisfies Delta);

/**
 * One generator per `DeltaKind`, typed as `Record<DeltaKind, ...>` on
 * purpose: if `Delta` ever grows a ninth kind, this object literal stops
 * compiling until a generator is added for it, so the round-trip and
 * "covers every kind" tests below can never silently go on exercising only
 * the old kinds. `deltaArb` and the expected-kinds list are both derived
 * from this map rather than hand-duplicated, so there is exactly one place
 * that has to change when a kind is added.
 */
const generatorsByKind: Record<DeltaKind, fc.Arbitrary<Delta>> = {
  'element.create': elementCreateArb,
  'element.update': elementUpdateArb,
  'element.retract': elementRetractArb,
  'element.restore': elementRestoreArb,
  'relationship.create': relationshipCreateArb,
  'relationship.update': relationshipUpdateArb,
  'relationship.retract': relationshipRetractArb,
  'relationship.restore': relationshipRestoreArb,
};

/** Every DeltaKind, each with real generative coverage — the arbitrary this whole file's properties run against. */
export const deltaArb: fc.Arbitrary<Delta> = fc.oneof(...Object.values(generatorsByKind));

describe('Delta JSON round trip (RT-1)', () => {
  it('is deep-equal after JSON.stringify/parse for every generated kind', () => {
    fc.assert(
      fc.property(deltaArb, (delta) => {
        const roundTripped: unknown = JSON.parse(JSON.stringify(delta));
        expect(roundTripped).toEqual(delta);
      }),
    );
  });

  it('covers every DeltaKind at least once across a real sample (not just in principle)', () => {
    const seen = new Set<DeltaKind>();
    fc.assert(
      fc.property(deltaArb, (delta) => {
        seen.add(delta.kind);
      }),
      { numRuns: 500 },
    );
    // Derived from generatorsByKind, not hand-typed — see the comment on
    // that Record for why: a hand-typed list here would just be wrong
    // (silently short) the day a kind is added, never failing to compile.
    const expectedKinds = Object.keys(generatorsByKind) as DeltaKind[];
    expect([...seen].sort()).toEqual([...expectedKinds].sort());
  });
});

describe('Delta <-> deltas row round trip (RT-1, contract level)', () => {
  it('fromDeltaRow(toDeltaRow(d)) is deep-equal to d for every generated kind', () => {
    fc.assert(
      fc.property(deltaArb, fc.uuid(), fc.uuid(), fc.uuid(), fc.integer({ min: 0, max: 1000 }), fc.uuid(), (delta, orgId, modelId, commitId, seq, createdBy) => {
        const row = toDeltaRow(delta, { orgId, modelId, commitId, seq, createdBy });
        const back = fromDeltaRow(row);
        expect(back).toEqual(delta);
      }),
    );
  });

  it('the row always carries the context fields verbatim', () => {
    fc.assert(
      fc.property(deltaArb, fc.uuid(), fc.uuid(), fc.uuid(), fc.integer({ min: 0, max: 1000 }), fc.uuid(), (delta, orgId, modelId, commitId, seq, createdBy) => {
        const row = toDeltaRow(delta, { orgId, modelId, commitId, seq, createdBy });
        expect(row.org_id).toBe(orgId);
        expect(row.model_id).toBe(modelId);
        expect(row.commit_id).toBe(commitId);
        expect(row.seq).toBe(seq);
        expect(row.created_by).toBe(createdBy);
      }),
    );
  });

  it('subject_type on the row always matches subjectOf(delta) (the DB\'s generated column, computed our side too)', () => {
    fc.assert(
      fc.property(deltaArb, fc.uuid(), fc.uuid(), fc.uuid(), fc.integer(), fc.uuid(), (delta, orgId, modelId, commitId, seq, createdBy) => {
        const row = toDeltaRow(delta, { orgId, modelId, commitId, seq, createdBy });
        expect(row.subject_type).toBe(subjectOf(delta).subjectType);
        expect(row.subject_id).toBe(subjectOf(delta).subjectId);
      }),
    );
  });

  it('the row\'s (subject_id, attribute) always matches factKeyOf(delta)', () => {
    fc.assert(
      fc.property(deltaArb, fc.uuid(), fc.uuid(), fc.uuid(), fc.integer(), fc.uuid(), (delta, orgId, modelId, commitId, seq, createdBy) => {
        const row = toDeltaRow(delta, { orgId, modelId, commitId, seq, createdBy });
        const key = factKeyOf(delta);
        expect(row.subject_id).toBe(key.subjectId);
        expect(row.attribute).toBe(key.attribute);
      }),
    );
  });
});

describe('CommitEnvelope <-> commits+deltas rows round trip (RT-2, contract level)', () => {
  const envelopeArb: fc.Arbitrary<CommitEnvelope> = fc
    .record({
      id: uuid,
      branchId: uuid,
      parentCommitId: fc.option(uuid, { nil: null }),
      mergedBranchHeadCommitId: fc.constant(null),
      kind: fc.constantFrom('manual' as const, 'capture' as const, 'template_seed' as const),
      message: fc.string({ minLength: 1, maxLength: 80 }),
      authorId: uuid,
      deltas: fc.array(deltaArb, { minLength: 0, maxLength: 6 }),
    });

  it('fromCommitRow(toCommitRow(e), envelopeToDeltaRows(e)) is deep-equal to e', () => {
    fc.assert(
      fc.property(envelopeArb, fc.uuid(), fc.uuid(), fc.integer({ min: 0, max: 100 }), fc.uuid(), (envelope, orgId, modelId, depth, createdBy) => {
        const commitRow = toCommitRow(envelope, { orgId, modelId, depth });
        const deltaRows = envelopeToDeltaRows(envelope, { orgId, modelId, createdBy });
        const back = fromCommitRow(commitRow, deltaRows);
        expect(back).toEqual(envelope);
      }),
    );
  });

  it('reconstructs correctly even when delta rows arrive out of seq order', () => {
    fc.assert(
      fc.property(
        envelopeArb.filter((e) => e.deltas.length >= 2),
        fc.uuid(),
        fc.uuid(),
        fc.integer({ min: 0, max: 100 }),
        fc.uuid(),
        (envelope, orgId, modelId, depth, createdBy) => {
          const commitRow = toCommitRow(envelope, { orgId, modelId, depth });
          const deltaRows = [...envelopeToDeltaRows(envelope, { orgId, modelId, createdBy })].reverse();
          const back = fromCommitRow(commitRow, deltaRows);
          expect(back).toEqual(envelope);
        },
      ),
    );
  });
});
