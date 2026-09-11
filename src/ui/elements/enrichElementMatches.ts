import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { getElementHead, listRelationshipsForElement } from '../../db/elements';
import { attributesRecord } from './attributesRecord';
import { supabase } from '../supabaseClient';

export interface MatchEnrichment {
  relationshipCount: number;
  /** The `owns` relationship's owning actor into this element, if any (only ever populated for a `system`, per `RELATIONSHIP_TYPE_RULES` — null for every other type, not specially cased). Prompt 7k item 2: a target can have up to three owners at once (one per role); this compact row picks the `business` owner when there is one, else whichever other role is present — same preference `elementBrowse.ts`'s own `loadOwnersByElementId` uses. */
  owner: ElementsHeadRow | null;
}

/**
 * Owner + relationship-count enrichment for a small, already-matched list of
 * elements (Handoff — Flow: Add a system, step 2's "system · owner · N
 * relationships" row) — one request per match, sized to a typeahead's own
 * small result list, never the whole search pool. Extracted once a second
 * caller needed it (`useHomeSearch.ts`, alongside `useElementSearchAdd.ts`'s
 * original), same as `lifecycleTone.ts`'s own history.
 */
export async function enrichElementMatches(commitId: UUID, matches: readonly ElementsHeadRow[]): Promise<Map<UUID, MatchEnrichment>> {
  const entries = await Promise.all(
    matches.map(async (element) => {
      const relationships = await listRelationshipsForElement(supabase, commitId, element.element_id);
      const isOwnsEdge = (r: (typeof relationships)[number]) => r.relationship_type === 'owns' && r.to_element_id === element.element_id;
      const ownerRelationship =
        relationships.find((r) => isOwnsEdge(r) && attributesRecord(r.attributes).role === 'business') ?? relationships.find((r) => isOwnsEdge(r));
      const owner = ownerRelationship ? await getElementHead(supabase, commitId, ownerRelationship.from_element_id) : null;
      return [element.element_id, { relationshipCount: relationships.length, owner }] as const;
    }),
  );
  return new Map(entries);
}
