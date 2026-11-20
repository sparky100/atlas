import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { defaultCreateAttributes } from '../../contracts/attributeSchema';
import type { CommitEnvelope, Delta, ElementType, UUID } from '../../contracts/delta';
import type { Json } from '../../contracts/rows';
import { getBranch, getMainBranch } from '../../db/branches';
import { listAllSupportsEdgeRows } from '../../db/landscape';
import { roleForNewSupporter } from './firstSupporterRole';
import { commitToBranch } from '../../db/commits';
import { describeEnvelope } from '../../engine/describeEnvelope';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { applyCommitToCache } from '../query/applyCommitToCache';
import { supabase } from '../supabaseClient';

export type ElementCreateStatus = 'idle' | 'creating';

export interface CreateOptions {
  /** Merged over `defaultCreateAttributes(elementType, {onMain})` — a provided key wins over the default for that same key (Handoff — Flow: Add a system, step 4's required description; C4 forbids a follow-up `element.update` in the same commit, so it has to ride in the create's own attributes). */
  attributes?: Record<string, Json>;
  /** Handoff — Flow: Add a system, step 4's "Supports which capability?": when given, a `relationship.create` (`supports`, this element → the capability) rides in the *same* commit as the `element.create` — C9 only requires both endpoints exist in the resulting head, which a same-commit pair satisfies. */
  supportsCapabilityId?: UUID;
  /** The same capability's name (the caller already has it — it's the picker result being clicked) — only for the generated commit title's "and link to X" (`describeEnvelope`'s `nameLookup`; B1). Ignored unless `supportsCapabilityId` is also given. */
  supportsCapabilityName?: string;
}

export interface UseElementCreateResult {
  status: ElementCreateStatus;
  error: string | null;
  create: (name: string, options?: CreateOptions) => Promise<void>;
}

export interface UseElementCreateInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  elementType: ElementType;
  /** Structural parent (ADR-001) — required non-null for container/component, null for system/actor (top-level). Not offered as a choice here: the page this control lives on (Landscape for system/actor, a system's own container list, a container's own component list) already fixes it. */
  parentId: UUID | null;
  /** Which branch this create commits to (Blocking: element creation — "main for architects/owners; the selected branch otherwise"): the caller resolves this the same way ElementPage.tsx already does, via `useEditingBranch`/`canEditBranch`. */
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onCreated: (elementId: UUID) => void;
}

/**
 * The search-first "Add" control's create step (Blocking: element
 * creation): one commit through `commit_deltas`, with the current user's
 * manual source as provenance — the same shape `useCapabilityCreate.ts`
 * already established for capabilities, generalised across every element
 * type this control creates (system, actor, container, component).
 * `defaultCreateAttributes` fills in whatever this type requires beyond a
 * name — including, for a system, `lifecycleStatus` defaulting to `active`
 * on `main` and `planned` on a change branch (`defaultCreateAttributes`'s
 * own doc comment explains why), driven by `branch.kind` here.
 *
 * Handoff — Flow: Add a system: `options.attributes` (e.g. a required
 * description) merges over the schema default rather than following the
 * create with a second delta (C4), and `options.supportsCapabilityId`, when
 * given, appends a `supports` `relationship.create` to the same commit
 * envelope — one commit for "create this system and link it," not two.
 */
export function useElementCreate(input: UseElementCreateInput): UseElementCreateResult {
  const { modelId, orgId, userId, elementType, parentId, branch, expectedHeadCommitId, onCreated } = input;
  const [status, setStatus] = useState<ElementCreateStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const create = useCallback(
    async (name: string, options?: CreateOptions) => {
      if (!userId) {
        setError(`You must be signed in to add a ${elementType}.`);
        return;
      }
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        setError('Name cannot be empty.');
        return;
      }
      setError(null);
      setStatus('creating');

      try {
        // E8 item (1) fallout: `expectedHeadCommitId` can be a few hundred
        // ms stale — read from the shared cache, which may still be
        // mid-refetch right after another action on this same branch just
        // invalidated it (`invalidateModelHead.ts`'s own comment on why
        // that refetch isn't awaited before the caller can act again). For
        // an *edit*, that staleness is exactly what C13's conflict check
        // should catch (the user's own draft was built against
        // possibly-stale facts). A *create* has nothing to clobber — it
        // only needs a valid parent commit to chain onto — so this
        // resolves the branch's own current head fresh, right here, rather
        // than trusting a prop that was merely "correct as of this
        // component's last render."
        const currentBranch = branch.kind === 'main' ? await getMainBranch(supabase, modelId) : await getBranch(supabase, branch.id);
        const currentHeadCommitId = currentBranch?.head_commit_id ?? expectedHeadCommitId;

        const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
        const elementId = crypto.randomUUID();

        // The attributes shape is genuinely per-`elementType` (`ElementAttributesByType[T]`)
        // — this control builds it dynamically from the schema rather than a
        // literal per-type branch, so the cast is the one place that
        // generality meets the delta union's own type, same as
        // scripts/loadCapabilityMaps.ts-style bulk construction elsewhere.
        const createDelta = {
          kind: 'element.create',
          id: crypto.randomUUID(),
          elementId,
          elementType,
          name: trimmed,
          parentId,
          attributes: { ...defaultCreateAttributes(elementType, { onMain: branch.kind === 'main' }), ...options?.attributes },
          sourceId: source.id,
          confidence: 1,
        } as Delta;

        const deltas: Delta[] = [createDelta];
        if (options?.supportsCapabilityId) {
          // The capability's first supporter is its main one. If the lookup fails the link is still made, as secondary (what it always was).
          let role: 'primary' | 'secondary' = 'secondary';
          try {
            role = roleForNewSupporter(await listAllSupportsEdgeRows(supabase, currentHeadCommitId), options.supportsCapabilityId);
          } catch {
            role = 'secondary';
          }
          deltas.push({
            kind: 'relationship.create',
            id: crypto.randomUUID(),
            relationshipId: crypto.randomUUID(),
            relationshipType: 'supports',
            fromElementId: elementId,
            toElementId: options.supportsCapabilityId,
            // The new element's very first supports link — the same
            // "never asked, created secondary outright" case
            // `defaultAttributesForPlainPick`'s own doc comment describes
            // (Sprint U4-1 B4): nothing to compare a brand-new element's
            // one-and-only link against yet, and `computeLandscapeLayout`'s
            // "no primary -> most recently added decides" fallback places
            // it correctly regardless.
            attributes: { role },
            sourceId: source.id,
            confidence: 1,
          });
        }

        // `describeEnvelope` never actually calls the name lookup for an
        // `element.create` delta on its own — the new element's name is
        // right there on the delta itself — but the 2-delta "create and
        // link" combination (a `supportsCapabilityId` create) does need it,
        // to resolve the capability's own name; the caller already has it
        // in hand (`options.supportsCapabilityName`), same convention as
        // `useRelationshipCreate.ts`'s own `otherElementName`.
        const nameLookup = (id: UUID): string | undefined => (options?.supportsCapabilityId && id === options.supportsCapabilityId ? options.supportsCapabilityName : undefined);
        const envelope: CommitEnvelope = {
          id: crypto.randomUUID(),
          branchId: branch.id,
          parentCommitId: currentHeadCommitId,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          title: describeEnvelope(deltas, nameLookup),
          body: `Add ${elementType} "${trimmed}"`,
          deltas,
        };

        const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId: currentHeadCommitId, envelope });
        if (!result.ok) {
          setStatus('idle');
          setError(
            result.reason === 'conflict'
              ? 'The model changed since you loaded it. Reload the page and try again.'
              : `Could not add: ${result.message}`,
          );
          return;
        }

        setStatus('idle');
        // E8 item (3): seed the cache with the head this commit already
        // computed before navigating on — `onCreated` (`HomeSearch.tsx`)
        // navigates straight to the new element's own page, which reads
        // `mainBranch`/`headAtCommit` from the same shared cache; without
        // this, that page could render against whichever commit_id was
        // cached before this one landed, and `elements_head` has zero rows
        // for the new element at that stale commit (SPEC §1 S-2/P-6) —
        // "This element is not present here."
        applyCommitToCache(queryClient, modelId, branch, result.commitId, result.newHead);
        onCreated(elementId);
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : `Could not add ${elementType}.`);
      }
    },
    [modelId, orgId, userId, elementType, parentId, branch, expectedHeadCommitId, onCreated, queryClient],
  );

  return { status, error, create };
}
