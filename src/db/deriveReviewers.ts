/**
 * F3a: deriving a change's reviewer set from ownership. Owners in Atlas are
 * Actor *elements* (`owns` edges, `role` business/technical/service); a
 * reviewer must be a *member*. The bridge is `ActorAttributes.memberId`
 * (`src/contracts/delta.ts`) — an actor whose `memberId` is set names the
 * member that actor represents. An owner actor with no `memberId` simply
 * contributes nothing (it can't be resolved to a member), the same "absent
 * is silent" stance the attribute itself documents.
 *
 * The derived set is: the touched systems' business and technical owners,
 * the affected capabilities' business owners, plus one architect-or-better
 * (`pickArchitect`'s own doc comment) — all `required`. It is a
 * *suggestion* the proposer confirms and adjusts in the submit reviewer
 * picker; the RPC (`atlas.submit_merge_request`) is the enforcement point,
 * re-checking the org's architect-or-better floor.
 */
import type { UUID } from '../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import { attributesRecord } from '../ui/elements/attributesRecord';
import { getMainBranch } from './branches';
import { loadChangeSummary } from './changeSummary';
import type { Client } from './client';
import { listOwnsEdges } from './elementBrowse';
import { listActorsForLandscape } from './landscape';
import { listMembers } from './organisations';
import type { BranchRow, MemberRole } from './types';

export interface ReviewerCandidate {
  userId: UUID;
  required: boolean;
}

function memberIdOf(actor: ElementsHeadRow | undefined): UUID | null {
  if (!actor) return null;
  const value = attributesRecord(actor.attributes).memberId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Pure: the owner-mapped reviewer candidates for a change — the touched
 * systems' business + technical owners and the affected capabilities'
 * business owners, resolved through the owner actors' own `memberId`.
 * Deduplicated by member (a member who owns several touched things appears
 * once). Actors without a `memberId` are skipped, not errored on.
 */
export function ownerReviewerCandidates(
  touchedSystemIds: readonly UUID[],
  affectedCapabilityIds: readonly UUID[],
  ownsEdges: readonly RelationshipsHeadRow[],
  actorsById: ReadonlyMap<UUID, ElementsHeadRow>,
): ReviewerCandidate[] {
  const businessByTarget = new Map<UUID, ElementsHeadRow>();
  const technicalByTarget = new Map<UUID, ElementsHeadRow>();
  for (const edge of ownsEdges) {
    const actor = actorsById.get(edge.from_element_id);
    if (!actor) continue;
    const role = attributesRecord(edge.attributes).role;
    if (role === 'business') businessByTarget.set(edge.to_element_id, actor);
    else if (role === 'technical') technicalByTarget.set(edge.to_element_id, actor);
  }

  const byUserId = new Map<UUID, ReviewerCandidate>();
  const add = (actor: ElementsHeadRow | undefined) => {
    const userId = memberIdOf(actor);
    if (userId !== null && !byUserId.has(userId)) byUserId.set(userId, { userId, required: true });
  };

  for (const systemId of touchedSystemIds) {
    add(businessByTarget.get(systemId));
    add(technicalByTarget.get(systemId));
  }
  for (const capabilityId of affectedCapabilityIds) {
    add(businessByTarget.get(capabilityId));
  }
  return [...byUserId.values()];
}

/**
 * Pure: the first architect member, deterministically — callers pass the
 * member list already sorted (the loader sorts by `joined_at` then
 * `user_id`, so this is stable for a given org). Falls back to the first
 * `owner` when there's no dedicated `architect` — `owner` counts as
 * architect-or-better for the org's review floor (`role in ('owner',
 * 'architect')`, `atlas.submit_merge_request`/`atlas.set_reviewers`,
 * 20260926010000_owner_counts_as_architect_reviewer.sql), so a solo-owner
 * org (no separate architect member at all) still gets a real suggestion
 * here instead of leaving the required architect slot for the proposer to
 * notice and fill in by hand.
 */
export function pickArchitect(members: readonly { userId: UUID; role: MemberRole }[]): UUID | null {
  const architect = members.find((m) => m.role === 'architect');
  if (architect) return architect.userId;
  const owner = members.find((m) => m.role === 'owner');
  return owner?.userId ?? null;
}

/**
 * The full derived set for a change — owner-mapped members plus one
 * architect (deduped). Pure of the DB reads above it; the loader below is
 * its only production caller.
 */
export function deriveReviewerSet(
  ownerCandidates: readonly ReviewerCandidate[],
  architectId: UUID | null,
): ReviewerCandidate[] {
  const result = [...ownerCandidates];
  if (architectId !== null && !result.some((r) => r.userId === architectId)) {
    result.push({ userId: architectId, required: true });
  }
  return result;
}

/**
 * Loads and derives a change's suggested reviewer set, ready for the submit
 * picker. Reads ownership facts at `main`'s current head (owners are
 * current facts, not the branch's own projected state) and the org's member
 * list (for the architect + to confirm each mapped member is still real).
 */
export async function loadDerivedReviewers(supabase: Client, modelId: UUID, orgId: UUID, branch: BranchRow): Promise<ReviewerCandidate[]> {
  const summary = await loadChangeSummary(supabase, modelId, branch);
  const touchedSystemIds = (summary?.subjects ?? []).filter((s) => s.subjectType === 'element' && s.elementType === 'system').map((s) => s.subjectId);
  const affectedCapabilityIds = (summary?.affectedCapabilities ?? []).map((c) => c.capability.element_id);

  const main = await getMainBranch(supabase, modelId);
  if (!main) return [];

  const [ownsEdges, actors, members] = await Promise.all([
    listOwnsEdges(supabase, main.head_commit_id),
    listActorsForLandscape(supabase, main.head_commit_id),
    listMembers(supabase, orgId),
  ]);

  const actorsById = new Map(actors.map((a) => [a.element_id, a]));
  const ownerCandidates = ownerReviewerCandidates(touchedSystemIds, affectedCapabilityIds, ownsEdges, actorsById);

  const sortedMembers = members
    .map((m) => ({ userId: m.member.user_id, role: m.member.role, joinedAt: m.member.joined_at }))
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.userId.localeCompare(b.userId));
  const architectId = pickArchitect(sortedMembers.map(({ userId, role }) => ({ userId, role })));

  return deriveReviewerSet(ownerCandidates, architectId);
}
