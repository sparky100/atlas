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
/** Prompt 7k item 1: how much a system matters to the estate — ordered, `critical` the highest (`src/ui/elements/criticalityTone.ts`'s `CRITICALITY_ORDER`), for the same "worst-of among supporting systems" capability-map aggregation `LifecycleStatus`'s own ordering already supports. */
export type Criticality = 'critical' | 'high' | 'medium' | 'low';
/** Prompt 7k item 1: where a system runs — a closed, unordered set (unlike `Criticality`), each value its own colour-by tone, never aggregated "worst of" for a capability (there is no "worse" hosting model — see `src/ui/capabilityMap/metrics.ts`'s own module comment for why capability-map colour-by only ever offers criticality, not this). */
export type HostingModel = 'on_premises' | 'private_cloud' | 'public_cloud' | 'saas' | 'hybrid';
/**
 * Prompt 7k item 3: IT/OT domain — a categorical, unordered set like
 * `HostingModel` (no "worse" domain to aggregate a capability's worst-of
 * to). Absent means `'it'` (the prompt's own stated default — the common
 * case for a regulated estate is IT, so only OT/hybrid systems need
 * marking) — this is a read-time default applied by
 * `src/ui/elements/systemDomain.ts`'s `domainOf`, never written back onto
 * a system that never recorded one, the same "an unset fact isn't the
 * same as a recorded 'it' fact" stance every other optional attribute
 * here takes. `ContainerAttributes` has no `domain` field of its own: a
 * container inherits its parent system's domain at read time
 * (`resolveElementDomain`), so there's no second copy that could drift
 * out of sync with it.
 */
export type SystemDomain = 'it' | 'ot' | 'hybrid';
/**
 * Prompt 7k item 4: what a system *is*, for landscape/routing purposes —
 * a categorical, unordered set, no colour-by of its own (unlike
 * `Criticality`/`HostingModel`/`SystemDomain`): this drives structural
 * layout (the landscape's platform band, `src/ui/landscape/layout.ts`)
 * and the `via` reference below, not a tone anyone would want to see
 * tinted. Absent reads as `'application'` (the read-time-default pattern
 * `SystemDomain` already established) — the common case is an ordinary
 * application; only a system that genuinely mediates flows between
 * others (an ESB, an API gateway, a data platform, a piece of
 * infrastructure like a message bus) needs marking.
 */
export type SystemKind = 'application' | 'integration_platform' | 'data_platform' | 'infrastructure';
export type ActorSubtype = 'person' | 'team';
export type DataClassification = 'public' | 'official' | 'official_sensitive' | 'special_category';
/** Sprint U4-1 B4: which of a system's `supports` edges anchors its one landscape lane (relationship_type_rules' new `maxPrimaryPerFrom: 1`, `supports`-only). Always set at creation, defaulting to `secondary` unless the picker's "primary?" prompt is answered yes — never left unset the way `SupportsAttributes.description` is, since lane placement has to read *something* off every edge. */
export type SupportsRole = 'primary' | 'secondary';
/** Prompt 7k item 2: which capacity an `owns` edge asserts ownership in — replaces the earlier `OwnsAttributes.primary: boolean` (Sprint U4-1), which only ever distinguished "the" owner from a secondary one and had no room for more than one kind of owner at once. Always set at creation, defaulting to `'business'` on a capability target and prompted for on a system target (`RelationshipAdd.tsx`) — never left unset, same reasoning `SupportsRole` above already gives. Cardinality is per `(toElementId, role)` (C17, `20260911070000_owns_role.sql`'s backstop index): a target may have at most one `business`, one `technical` and one `service` owner, but all three may be different actors at once. */
export type OwnsRole = 'business' | 'technical' | 'service';

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
  /**
   * ADR-020: an organisation's own optional reference (an internal
   * catalog number, a cross-reference into another system) — never
   * populated by `atlas.seed_from_map`/`buildSeedDeltas`. A seeded
   * capability's template code stays reachable via `templateRef` and its
   * `template_code` alias, not this field; was previously "reference code
   * from a starter capability map, e.g. '2.3'," copied onto every seeded
   * element unconditionally.
   */
  code?: string;
  /** `capability_map_items.id` this capability was seeded from. */
  templateRef?: UUID;
  /**
   * Explicit display order among this capability's siblings (same
   * `parentId`), independent of `code` (Sprint U4-1 C1,
   * `capability_map_items.item_order`) — `src/ui/capabilityMap/layout.ts`'s
   * `compareCapabilities` sorts by this first. Set at seed time for every
   * capability a starter map produces (`capabilityMapContent.ts` requires
   * one on every template item); left unset for a hand-added capability
   * until the tailoring flow's reorder control gives it one — an unset
   * capability sorts after every ordered sibling, never before.
   */
  order?: number;
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
  /** Prompt 7k item 1: how much this system matters to the estate — drives the landscape/capability-map "criticality" colour-by and the "critical systems without a business owner"/"critical, exposed, no planned replacement" health findings. Optional: unrated until someone records it, same as `vendor`. */
  criticality?: Criticality;
  /** Prompt 7k item 1. Optional, same reasoning as `criticality`. */
  hostingModel?: HostingModel;
  /** Free text (a specific vendor/data-centre/region) — deliberately not an enum, unlike `hostingModel` itself: the set of real hosting providers is open-ended in a way on/prem-vs-cloud-vs-SaaS is not. */
  hostingProvider?: string;
  /** Prompt 7k item 3: IT, OT, or hybrid — drives the landscape's OT zone/colour-by, the capability map's "OT share" colour-by, and the boundary-crossings finding/list. Optional; absent reads as `'it'` (`SystemDomain`'s own comment). */
  domain?: SystemDomain;
  /** Prompt 7k item 4: application, integration/data platform, or infrastructure — drives the landscape's platform band and which systems `via` (below) may reference. Optional; absent reads as `'application'` (`SystemKind`'s own comment). */
  kind?: SystemKind;
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
  /** Sprint U4-1 B4 — see `SupportsRole`'s own doc comment. */
  role: SupportsRole;
}
export interface UsesAttributes {
  description?: string;
  /** Prompt 7k item 4: an optional element ref to the `system` (of `kind: 'integration_platform'`) this flow actually goes via — an ESB/API gateway/message bus sitting between `fromElementId` and `toElementId`, not a third real endpoint of its own (C18, `src/engine/deltas.ts`'s `apply()`, validates the reference at commit time). Direct edges (no `via`) are the default; the landscape only routes an edge through its `via` node when the "route via platforms" toggle is on (unpersisted view state, `src/ui/landscape/LandscapeCanvas.tsx` — never a stored preference, keeping this item's migration footprint at zero). */
  via?: UUID;
}
export interface OwnsAttributes {
  /** See `OwnsRole`'s own doc comment. At most one live edge per `(toElementId, role)` (relationship_type_rules, C17). Required — every new `owns` edge sets it at creation, unlike `primary` below, which no new code ever sets again. */
  role: OwnsRole;
  /**
   * @deprecated Superseded by `role` (Prompt 7k item 2) — kept on the type,
   * not removed, so a pre-migration `owns` edge's stored attributes (which
   * only ever had `primary`, never `role`) still type-checks when read
   * back narrowly, and so a reader of this interface can see the history
   * rather than wonder where the field went. Never set by new code: every
   * write path now sets `role` only. Existing data is migrated to `role`
   * via a real `relationship.update` commit
   * (`src/db/backfillOwnsRole.ts`/`scripts/backfillOwnsRole.ts`, run once
   * per model), never a raw row edit — SPEC §6.8's "data changes are
   * commits, never row rewrites."
   */
  primary?: boolean;
}
export interface FlowsToAttributes {
  description?: string;
  dataClassification?: DataClassification;
  protocol?: string;
  /** See `UsesAttributes.via`'s own doc comment — identical meaning and validation, `flows_to`'s own copy since each relationship type's attributes are their own interface. */
  via?: UUID;
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

export type CommitKind = 'genesis' | 'manual' | 'capture' | 'merge' | 'template_seed';

/**
 * No `authorId` field (Sprint H1, docs/AUDIT-2026-09-U2.md §2.E.3 item 15):
 * `atlas.commit_deltas` has always derived `commits.author_id`/
 * `deltas.created_by` from `auth.uid()`, never from anything the client
 * claims — a wire-supplied author field here would only ever have been
 * decorative for those two, and was in fact the untrusted source of
 * `facts.asserted_by`/`facts.asserted_at` (SPEC §3.5), which is now fixed
 * the same way. Nobody composing a `CommitEnvelope` has any authority over
 * who it says wrote it; `auth.uid()` is the only source, everywhere.
 */
export interface CommitEnvelope {
  id: UUID;
  branchId: UUID;
  /**
   * Never null in a client-constructed envelope (ADR-018): a model's main
   * branch always has a real head, even before anything has been committed
   * to it — the initial genesis commit that makes that true is inserted
   * only by `atlas.on_model_created`, never via `commit_deltas` or any
   * other RPC a client calls, so `kind: 'genesis'` and a null parent never
   * appear here.
   */
  parentCommitId: UUID | null;
  /**
   * Second parent. Set only when kind === 'merge':
   *  - on a change branch: the main commit being pulled in (a "refresh");
   *  - on main: the change-branch head being merged (ADR-006).
   */
  mergedBranchHeadCommitId: UUID | null;
  kind: CommitKind;
  /**
   * Generated, not typed by hand (Sprint U4-1 B1): `src/engine/
   * describeEnvelope.ts`'s `describeEnvelope(deltas, nameLookup)`, for
   * every `manual` commit. `merge`/`template_seed`/`genesis` commits keep
   * their own domain-specific phrasing instead (mergeRequests.ts, seedFromMap.ts,
   * `atlas.on_model_created`) — `describeEnvelope`'s own module comment
   * explains why those three don't route through it.
   */
  title: string;
  /** Whatever a hook used to hand-write as `message` before this sprint (e.g. `Edit ${element.name}`) — kept, not discarded, as an optional elaboration alongside the generated `title`. No UI reads or writes this yet beyond carrying it through; `null` when a caller has nothing to add. */
  body: string | null;
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
  {
    id: 'C17',
    text: "relationship.create/relationship.update/relationship.restore setting (or reviving, for restore) supports.role = 'primary', or setting an owns.role of any value: no other live relationship in the resulting head already holds the same value on the same anchor element — supports' anchor is fromElementId, one primary capability per system (a 'secondary' supports.role has no cardinality limit); owns' anchor is toElementId, one owner per role per owned element (Prompt 7k item 2 — 'business'/'technical'/'service' are each independently capped at one, so a target may have up to three owners at once, never two of the same role). A same-commit delta demoting/reassigning the existing one first (earlier in seq order) makes the promotion legal; a restore is checked against the head as it stands now, not as it stood when the relationship was retracted.",
  },
  {
    id: 'C18',
    text: "relationship.create/relationship.update setting uses.via or flows_to.via to a non-null value: the referenced element exists in the head as it stands at the point this delta is applied and is a system with kind === 'integration_platform' (Prompt 7k item 4). Not re-checked at relationship.restore, matching C9's own endpoint check, which restore also does not re-run — a restored edge is trusted to reconstruct exactly the state it last held, not re-validated against the current head.",
  },
] as const;

export type CommitInvariantId = (typeof COMMIT_INVARIANTS)[number]['id'];
