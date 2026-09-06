/**
 * Atlas delta contract.
 *
 * A delta is one fact assertion (ADR-002 / ADR-007). A commit is an ordered
 * list of deltas. This file is the wire and storage contract only: no
 * validation logic, no engine. Field names are camelCase on the wire and
 * snake_case in Postgres; the mapping is mechanical (see
 * docs/SPEC-data-model.md §4.4).
 *
 * Fact key: every delta asserts exactly one fact, identified by
 * (subjectId, attribute). Existence of a subject is itself a fact with the
 * reserved attribute `$exists`. `factKeyOf()` below is the single definition
 * of that mapping.
 */

/** UUID v7, minted by whoever composes the delta (client, capture worker, merge tool). */
export type UUID = string;
/** Calendar date, ISO 8601 `YYYY-MM-DD`. */
export type ISODate = string;

// ---------------------------------------------------------------------------
// Taxonomy (ADR-001)
// ---------------------------------------------------------------------------

export const ELEMENT_TYPES = ['capability', 'system', 'container', 'component', 'actor'] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const RELATIONSHIP_TYPES = ['supports', 'uses', 'owns', 'flows_to'] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/**
 * Explicitly not types (ADR-001 preface). Not a runtime list — there is
 * nothing to validate against — but named here, next to the real taxonomy,
 * so a request to add one of these has to argue against a written decision
 * rather than accrete quietly: business processes/workflow steps
 * (BPMN-shaped), logical data entities (ERD-shaped), infrastructure/network
 * topology, projects/programmes as landscape elements (a programme is a
 * change branch's metadata, not a fact), goals/strategy/KPIs, requirements/
 * user stories, cost/budget figures, risk register entries, service-
 * catalogue entries (model as a capability tag, not a type), maturity/heat-
 * map ratings, and org-chart reporting lines beyond a flat Actor. "External"
 * is deliberately an attribute (`isExternal`) on System/Container/Actor, not
 * a sixth element type; "contains" is deliberately structural (`parentId`),
 * not a seventh relationship type — see ADR-001's Alternatives Rejected.
 */
export const DELIBERATELY_NOT_MODELLED = [
  'business-process',
  'data-entity',
  'infrastructure-topology',
  'project-or-programme',
  'goal-strategy-kpi',
  'requirement-or-user-story',
  'cost-or-budget',
  'risk-register-entry',
  'service-catalogue-entry',
  'maturity-rating',
  'org-chart-reporting-line',
] as const;

export type LifecycleStatus = 'planned' | 'active' | 'retiring' | 'retired';
export type ActorSubtype = 'person' | 'team';
export type DataClassification = 'public' | 'official' | 'official_sensitive' | 'special_category';

/**
 * Attributes stored in `elements_head.attributes` (jsonb). `name` and
 * `parentId` are promoted columns and are NOT in this object.
 *
 * No `level` here (ADR-016, amending ADR-001): SPEC §6.3's V2 validates
 * that a capability's parent, if any, is another capability, but never
 * that a stored `level` value matches actual `parent_id` nesting depth —
 * a capability's real level is always `1 + the number of capability
 * ancestors above it`, computed from structure, never stored as an
 * independently-editable fact that could drift out of sync with it. See
 * src/ui/elements/capabilityDepth.ts for the computation.
 */
export interface CapabilityAttributes {
  description?: string;
  /** Reference code from a starter capability map, e.g. "2.3". */
  code?: string;
  /** `capability_map_items.id` this capability was seeded from. */
  templateRef?: UUID;
}

export interface SystemAttributes {
  description?: string;
  lifecycleStatus: LifecycleStatus;
  vendor?: string;
  isExternal: boolean;
  externalOrganisation?: string;
  /** When this system was introduced/went live. Distinct from a delta's own `effectiveDate` (when we learned the fact) — this is a fact about the system itself. */
  introduced?: ISODate;
  /** Planned decommission/retirement date, if one is known. Not the same as `lifecycleStatus: 'retired'` — a system can have a planned end date well before it actually retires. */
  plannedEnd?: ISODate;
}

export interface ContainerAttributes {
  description?: string;
  technology?: string;
  isExternal: boolean;
  /** See `SystemAttributes.introduced`. */
  introduced?: ISODate;
  /** See `SystemAttributes.plannedEnd`. */
  plannedEnd?: ISODate;
}

export interface ComponentAttributes {
  description?: string;
  technology?: string;
}

export interface ActorAttributes {
  subtype: ActorSubtype;
  /** Person only. */
  email?: string;
  orgUnit?: string;
  isExternal: boolean;
  externalOrganisation?: string;
}

export interface ElementAttributesByType {
  capability: CapabilityAttributes;
  system: SystemAttributes;
  container: ContainerAttributes;
  component: ComponentAttributes;
  actor: ActorAttributes;
}

/** Attributes stored in `relationships_head.attributes` (jsonb). Endpoints are immutable and are not attributes. */
export interface SupportsAttributes {
  description?: string;
}
export interface UsesAttributes {
  description?: string;
}
export interface OwnsAttributes {
  /** At most one primary owner per owned element (relationship_type_rules). */
  primary: boolean;
}
export interface FlowsToAttributes {
  description?: string;
  dataClassification?: DataClassification;
  protocol?: string;
}

export interface RelationshipAttributesByType {
  supports: SupportsAttributes;
  uses: UsesAttributes;
  owns: OwnsAttributes;
  flows_to: FlowsToAttributes;
}

// ---------------------------------------------------------------------------
// Attribute keys addressable by an update delta
// ---------------------------------------------------------------------------

/** Element attributes that live in real columns on `elements_head`, not in the jsonb blob. */
export type PromotedElementAttribute = 'name' | 'parentId';

export type ElementAttributeKey<T extends ElementType> =
  | PromotedElementAttribute
  | (keyof ElementAttributesByType[T] & string);

export type ElementAttributeValue<T extends ElementType, K extends ElementAttributeKey<T>> =
  K extends 'name' ? string
  : K extends 'parentId' ? UUID | null
  : K extends keyof ElementAttributesByType[T] ? ElementAttributesByType[T][K] | null
  : never;

export type RelationshipAttributeKey<R extends RelationshipType> = keyof RelationshipAttributesByType[R] & string;

export type RelationshipAttributeValue<R extends RelationshipType, K extends RelationshipAttributeKey<R>> =
  RelationshipAttributesByType[R][K] | null;

/** Reserved fact attribute for existence of a subject. Never a user-visible attribute. */
export const EXISTS_ATTRIBUTE = '$exists' as const;

// ---------------------------------------------------------------------------
// Provenance (ADR-007) — carried on every delta, never on a head row
// ---------------------------------------------------------------------------

export interface Provenance {
  /** `sources.id`. Required. Manual edits use the caller's per-model `manual` source. */
  sourceId: UUID;
  /** Locator inside the source: sheet!cell, page number, timestamp, paragraph id. */
  sourceRef?: string;
  /** When the fact was true in the world (not when it was recorded). */
  effectiveDate?: ISODate;
  /** 0.00–1.00. Human-asserted facts are 1.00; template seeds are 1.00; capture output is model-scored. */
  confidence: number;
}

interface DeltaBase extends Provenance {
  /** Delta id, UUID v7. */
  id: UUID;
}

// ---------------------------------------------------------------------------
// Element deltas
// ---------------------------------------------------------------------------

export type ElementCreate<T extends ElementType = ElementType> = T extends ElementType
  ? DeltaBase & {
      kind: 'element.create';
      elementId: UUID;
      elementType: T;
      name: string;
      /** Structural parent (ADR-001). Required non-null for container and component; null for top-level capability, system, actor. */
      parentId: UUID | null;
      attributes: ElementAttributesByType[T];
    }
  : never;

export type ElementUpdate<T extends ElementType = ElementType> = T extends ElementType
  ? {
      [K in ElementAttributeKey<T>]: DeltaBase & {
        kind: 'element.update';
        elementId: UUID;
        elementType: T;
        attribute: K;
        value: ElementAttributeValue<T, K>;
        /** The delta currently asserting this (elementId, attribute) in the parent commit's head. */
        previousDeltaId: UUID;
      };
    }[ElementAttributeKey<T>]
  : never;

export interface ElementRetract extends DeltaBase {
  kind: 'element.retract';
  elementId: UUID;
  elementType: ElementType;
  /** The delta currently asserting `$exists` for this element (its create, or its most recent restore). */
  previousDeltaId: UUID;
}

export interface ElementRestore extends DeltaBase {
  kind: 'element.restore';
  elementId: UUID;
  elementType: ElementType;
  /** The retract delta being reversed. */
  previousDeltaId: UUID;
}

// ---------------------------------------------------------------------------
// Relationship deltas
// ---------------------------------------------------------------------------

export type RelationshipCreate<R extends RelationshipType = RelationshipType> = R extends RelationshipType
  ? DeltaBase & {
      kind: 'relationship.create';
      relationshipId: UUID;
      relationshipType: R;
      /** Immutable after creation. To re-point a relationship, retract and create. */
      fromElementId: UUID;
      toElementId: UUID;
      attributes: RelationshipAttributesByType[R];
    }
  : never;

export type RelationshipUpdate<R extends RelationshipType = RelationshipType> = R extends RelationshipType
  ? {
      [K in RelationshipAttributeKey<R>]: DeltaBase & {
        kind: 'relationship.update';
        relationshipId: UUID;
        relationshipType: R;
        attribute: K;
        value: RelationshipAttributeValue<R, K>;
        previousDeltaId: UUID;
      };
    }[RelationshipAttributeKey<R>]
  : never;

export interface RelationshipRetract extends DeltaBase {
  kind: 'relationship.retract';
  relationshipId: UUID;
  relationshipType: RelationshipType;
  previousDeltaId: UUID;
}

export interface RelationshipRestore extends DeltaBase {
  kind: 'relationship.restore';
  relationshipId: UUID;
  relationshipType: RelationshipType;
  previousDeltaId: UUID;
}

// ---------------------------------------------------------------------------
// The union
// ---------------------------------------------------------------------------

export type ElementDelta = ElementCreate | ElementUpdate | ElementRetract | ElementRestore;
export type RelationshipDelta = RelationshipCreate | RelationshipUpdate | RelationshipRetract | RelationshipRestore;
export type Delta = ElementDelta | RelationshipDelta;

export type DeltaKind = Delta['kind'];
export const DELTA_KINDS = [
  'element.create',
  'element.update',
  'element.retract',
  'element.restore',
  'relationship.create',
  'relationship.update',
  'relationship.retract',
  'relationship.restore',
] as const satisfies readonly DeltaKind[];

export type SubjectType = 'element' | 'relationship';

/** The (subjectType, subjectId) a delta is about. */
export function subjectOf(d: Delta): { subjectType: SubjectType; subjectId: UUID } {
  switch (d.kind) {
    case 'element.create':
    case 'element.update':
    case 'element.retract':
    case 'element.restore':
      return { subjectType: 'element', subjectId: d.elementId };
    case 'relationship.create':
    case 'relationship.update':
    case 'relationship.retract':
    case 'relationship.restore':
      return { subjectType: 'relationship', subjectId: d.relationshipId };
  }
}

/**
 * The single fact a delta asserts or withdraws, as (subjectId, attribute).
 * create / retract / restore all address the `$exists` fact; update addresses a named attribute.
 * This is the key used by `facts`, by supersession (`previousDeltaId`), and by three-way merge.
 */
export function factKeyOf(d: Delta): { subjectId: UUID; attribute: string } {
  const { subjectId } = subjectOf(d);
  switch (d.kind) {
    case 'element.update':
    case 'relationship.update':
      return { subjectId, attribute: d.attribute };
    default:
      return { subjectId, attribute: EXISTS_ATTRIBUTE };
  }
}

// ---------------------------------------------------------------------------
// Commit envelope
// ---------------------------------------------------------------------------

export type CommitKind = 'manual' | 'capture' | 'merge' | 'template_seed';

export interface CommitEnvelope {
  id: UUID;
  branchId: UUID;
  /** Null only for the genesis commit of a model's main branch. */
  parentCommitId: UUID | null;
  /**
   * Second parent. Set only when kind === 'merge':
   *  - on a change branch: the main commit being pulled in (a "refresh");
   *  - on main: the change-branch head being merged (ADR-006).
   */
  mergedBranchHeadCommitId: UUID | null;
  kind: CommitKind;
  message: string;
  /** `auth.users.id` for manual/merge; the capture worker's service identity for capture. */
  authorId: UUID;
  /** Ordered. Index in this array is `deltas.seq`. */
  deltas: Delta[];
}

/**
 * Invariants a commit must satisfy to be accepted (SPEC-data-model §5.2).
 * Exported so tests can reference each by id. Prose here is the contract; the
 * spec document is the authority if they ever disagree.
 */
export const COMMIT_INVARIANTS = [
  { id: 'C1', text: 'A non-merge commit has at least one delta. A merge commit may have zero.' },
  { id: 'C2', text: 'deltas[i].seq === i; seq is contiguous from 0.' },
  { id: 'C3', text: 'Every delta is well-formed for its kind (required fields present, elementType/relationshipType valid, confidence in [0,1]).' },
  { id: 'C4', text: 'At most one delta per fact key (subjectId, attribute) per commit. A create already carries initial attributes; do not follow it with updates in the same commit.' },
  { id: 'C5', text: 'element.create / relationship.create: the subject id has never appeared in any delta of this model, on any branch. Ids are never reused.' },
  { id: 'C6', text: 'update / retract / restore: previousDeltaId equals facts[head(parentCommit)][(subjectId, attribute)].deltaId. This is the optimistic-concurrency check; a stale previousDeltaId is a rejected commit, not a silent overwrite.' },
  { id: 'C7', text: 'element.retract: the parent head contains the element; element.restore: the parent head does not contain it and previousDeltaId is its most recent retract. Same for relationships.' },
  { id: 'C8', text: 'element.retract: every relationship with the element as an endpoint, and every element whose parentId is the element, is retracted or re-parented in the same commit. No cascades.' },
  { id: 'C9', text: 'relationship.create: both endpoints exist in the resulting head (after applying the whole commit) and (relationshipType, fromType, toType) is in relationship_type_rules.' },
  { id: 'C10', text: 'relationship.create: no other live relationship in the resulting head has the same (relationshipType, fromElementId, toElementId).' },
  { id: 'C11', text: 'parentId on create/update: the parent exists in the resulting head, has the type required for the child type, and no parent chain forms a cycle.' },
  { id: 'C12', text: 'sourceId refers to a source in the same model. effectiveDate, if present, is not in the future.' },
  { id: 'C13', text: 'parentCommitId equals the branch head at the moment of insert (single-writer per branch).' },
  { id: 'C14', text: 'kind === "merge" iff mergedBranchHeadCommitId is non-null. A merge commit on main is created only by the merge procedure, never by a direct insert.' },
  { id: 'C15', text: 'Merge commit: every fact key changed to different values on both sides since the merge base has exactly one delta in this commit (a resolution); no delta addresses a fact key that is not a field conflict.' },
  { id: 'C16', text: 'The resulting head passes the validation level required for the branch kind: capture_draft → structural only; change → structural, schema advisory; main → structural and schema (SPEC §6.3).' },
] as const;

export type CommitInvariantId = (typeof COMMIT_INVARIANTS)[number]['id'];
