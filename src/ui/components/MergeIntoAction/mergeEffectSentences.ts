/**
 * "Merge into…"'s own confirmation preview (E7) — pulled out of
 * `MergeIntoAction.tsx` so it's unit-testable without mounting a
 * component, the same reasoning `relationshipRemovalEffect.ts` already
 * gives for the analogous "Remove from model…" cascade (CLAUDE.md rule 7:
 * no stand-in confirmation UI — this is the real content it shows, not a
 * bare confirm string). Reads `buildMergeElementsDeltas`'s own `effect`
 * (`src/engine/mergeElements.ts`) directly — the exact classification the
 * real commit uses, never a second, independently re-derived one that
 * could drift from it.
 */
import type { UUID } from '../../../contracts/delta';
import type { MergeEffect } from '../../../engine/mergeElements';
import { INBOUND_VERB, OUTBOUND_VERB } from '../../elements/relationshipVerbs';

/** One line per relationship the merge touches, in `effect.relationships` order. */
export function mergeRelationshipEffectSentences(effect: MergeEffect, survivorName: string, loserName: string, nameOf: (id: UUID) => string): string[] {
  return effect.relationships.map((item) => {
    const otherName = nameOf(item.otherElementId);
    const verb = item.loserSide === 'from' ? OUTBOUND_VERB[item.relationshipType] : INBOUND_VERB[item.relationshipType];
    switch (item.outcome) {
      case 'repointed':
        return `${survivorName} ${verb} ${otherName} (re-pointed from ${loserName}).`;
      case 'repointed-demoted-secondary':
        return `${survivorName} ${verb} ${otherName} (re-pointed from ${loserName}, demoted to secondary — ${survivorName} already has a primary here).`;
      case 'dropped-duplicate':
        return `${loserName} ${verb} ${otherName} is dropped — ${survivorName} already has this relationship.`;
      case 'dropped-cardinality':
        return `${loserName} ${verb} ${otherName} is dropped — ${survivorName} already owns it in that role.`;
      case 'dropped-self-loop':
        return `${loserName} ${verb} ${otherName} is dropped — merging the two would make it a relationship to itself.`;
    }
  });
}

/** One line per child re-parented onto the survivor. */
export function mergeReparentEffectSentences(effect: MergeEffect, survivorName: string, nameOf: (id: UUID) => string): string[] {
  return effect.reparentedChildIds.map((childId) => `${nameOf(childId)} moves under ${survivorName}.`);
}
