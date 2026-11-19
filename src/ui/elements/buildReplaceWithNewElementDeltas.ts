import { defaultCreateAttributes } from '../../contracts/attributeSchema';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../contracts/rows';
import { buildReplacesDelta } from '../../engine/buildReplacesDelta';
import { describeEnvelope } from '../../engine/describeEnvelope';
import type { BranchRow } from '../../db/types';
import { attributesRecord } from './attributesRecord';
import { buildCopiedEdgeDeltas } from './replacementEdges';

export interface ReplaceWithNewElementInput {
  /** The retiring element (A) — a system, or (platforms and modules) a container/module, same scope `useElementRetire.ts` already has. */
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  /** A's own live relationships (`ElementPageData.relationships`) — same input `useElementRetire.ts` already takes, no new round trip. */
  relationships: readonly RelationshipsHeadRow[];
  plannedEnd: string;
  /** The new element's (B's) own name — everything else about B is left blank (`defaultCreateAttributes`'s own required-field defaults only), never copied from A: a replacement is usually a different real product (different vendor/version/hosting), so carrying A's values over could silently mislead. */
  replacementName: string;
  /** Which of A's links to copy onto B (their relationship ids). Absent copies every capability link and interface (`listCopyableEdges`); a person can untick any in the retire panel. */
  copyEdgeIds?: ReadonlySet<UUID> | undefined;
  sourceId: UUID;
  /** `useElementCreate.ts`'s own `defaultCreateAttributes` context — `lifecycleStatus` defaults to `active` on main, `planned` on a change branch. */
  onMain: boolean;
}

export interface ReplaceWithNewElementResult {
  deltas: Delta[];
  newElementId: UUID;
}

/**
 * "Replace A with a brand-new B" — the gap the existing "Retire… → replaced
 * by" flow (`useElementRetire.ts`) can't close on its own: its own
 * "replaced by" picker searches main's real materialised head only
 * (`src/db/elementSearch.ts`'s own module comment, deliberate), so when B
 * doesn't exist yet, the only path today is two separate changes — one to
 * create and merge B, a second to retire A now that B is searchable.
 *
 * This closes that gap for the one case that never needed search at all:
 * when B is being created as part of the *same* action, its id is known
 * the instant it's created, so there's nothing to find. One commit:
 * create B, retire A (`lifecycleStatus`/`plannedEnd`, identical to
 * `useElementRetire.ts`), then copy A's links onto B — its capability
 * (`supports`) links as `role: 'secondary'` (never the original role, for the
 * primary-collision reasoning `useElementRetire.ts`'s own comment gives) and
 * its interfaces (`uses`/`flows_to`, either direction, attributes kept),
 * all by default, or only the ones the person left ticked (`copyEdgeIds`) —
 * plus the `replaces` edge (ADR-001 amendment, `buildReplacesDelta`, B
 * replaces A).
 *
 * Deliberately out of scope, disclosed rather than silently dropped:
 * `owns` edges (an actor's ownership of A) never transfer — a person
 * doing this can add ownership on B separately; and a flow naming A as its
 * `via` (A is an integration platform other flows route through, not itself
 * an endpoint) is invisible here, since `relationships` only ever holds edges
 * where A is `from`/`to`.
 *
 * Extracted as its own pure function (input in, deltas out, no I/O) rather
 * than inlined in a hook the way `useElementRetire.ts` is — this case is
 * meaningfully more complex (directional logic per relationship type), so
 * it earns the same "call the real builder in a unit test" treatment
 * `src/engine/mergeElements.ts`'s `buildMergeElementsDeltas` already gets
 * for a comparably complex multi-delta operation.
 */
export function buildReplaceWithNewElementDeltas(input: ReplaceWithNewElementInput): ReplaceWithNewElementResult {
  const { element, facts, relationships, plannedEnd, replacementName, sourceId, onMain, copyEdgeIds } = input;
  const deltas: Delta[] = [];
  const newElementId = crypto.randomUUID();

  // A module's own replacement is another module of the same platform —
  // silently inheriting A's own parent (never asked for, per the same
  // "no picker needed" call this design made for the replaced-by-existing
  // case, since a module's platform essentially never changes on
  // replacement) — a system's replacement has no parent at all (ADR-001).
  const parentId = element.element_type === 'container' ? element.parent_id : null;
  deltas.push({
    kind: 'element.create',
    id: crypto.randomUUID(),
    elementId: newElementId,
    elementType: element.element_type,
    name: replacementName,
    parentId,
    attributes: defaultCreateAttributes(element.element_type, { onMain }),
    sourceId,
    confidence: 1,
  } as Delta);

  const currentLifecycleStatus = attributesRecord(element.attributes).lifecycleStatus;
  if (currentLifecycleStatus !== 'retiring') {
    deltas.push({
      kind: 'element.update',
      id: crypto.randomUUID(),
      elementId: element.element_id,
      elementType: element.element_type,
      attribute: 'lifecycleStatus',
      value: 'retiring',
      previousDeltaId: facts.get('lifecycleStatus')?.delta_id ?? element.exists_delta_id,
      sourceId,
      confidence: 1,
    } as Delta);
  }

  deltas.push({
    kind: 'element.update',
    id: crypto.randomUUID(),
    elementId: element.element_id,
    elementType: element.element_type,
    attribute: 'plannedEnd',
    value: plannedEnd,
    previousDeltaId: facts.get('plannedEnd')?.delta_id ?? element.exists_delta_id,
    sourceId,
    confidence: 1,
  } as Delta);

  // Capability links (always secondary) and interfaces (`uses`, `flows_to`, either direction, attributes kept): see `replacementEdges.ts`. A copy, never a move — A keeps its own until its planned end.
  deltas.push(...buildCopiedEdgeDeltas({ oldId: element.element_id, newId: newElementId, relationships, chosen: copyEdgeIds, sourceId }));

  deltas.push(buildReplacesDelta(newElementId, element.element_id, sourceId));

  return { deltas, newElementId };
}

export interface ReplaceWithNewElementEnvelopeInput extends ReplaceWithNewElementInput {
  branch: BranchRow;
  expectedHeadCommitId: UUID;
}

/** `buildReplaceWithNewElementDeltas`'s own result, wrapped into a real `CommitEnvelope` — the one extra step `useReplaceWithNewElement.ts` needs before `commitToBranch`, split out so a unit test can call the pure half alone without constructing a branch. */
export function buildReplaceWithNewElementEnvelope(input: ReplaceWithNewElementEnvelopeInput): { envelope: CommitEnvelope; newElementId: UUID } {
  const { branch, expectedHeadCommitId, ...rest } = input;
  const { deltas, newElementId } = buildReplaceWithNewElementDeltas(rest);
  const nameLookup = (id: UUID) => (id === rest.element.element_id ? rest.element.name : id === newElementId ? rest.replacementName : undefined);
  const envelope: CommitEnvelope = {
    id: crypto.randomUUID(),
    branchId: branch.id,
    parentCommitId: expectedHeadCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: describeEnvelope(deltas, nameLookup),
    body: `Retire ${rest.element.name}, replaced by new ${rest.replacementName}`,
    deltas,
  };
  return { envelope, newElementId };
}
