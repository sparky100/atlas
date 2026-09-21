/**
 * "Convert to a module of…"'s own confirmation-preview sentences — pulled
 * into its own file so they're unit-testable without mounting a component,
 * the same split `relationshipRemovalEffect.ts`/`mergeEffectSentences.ts`
 * already establish in their own directories.
 */
import type { RelationshipType } from '../../../contracts/delta';
import type { ConvertedRelationship } from '../../../engine/convertSystemToModule';

/**
 * Deliberately its own map, not `RelationshipsSection.tsx`'s private
 * `DIRECTION_LABEL` or `relationshipRemovalEffect.ts`'s private
 * `EFFECT_VERB` — same reasoning that file's own doc comment gives for
 * keeping its verb forms separate: "will still {verb}" needs the bare
 * infinitive/passive forms, not either of those files' own label shapes.
 */
const STILL_VERB: Record<RelationshipType, { from: string; to: string }> = {
  supports: { from: 'support', to: 'be supported by' },
  uses: { from: 'use', to: 'be used by' },
  owns: { from: 'own', to: 'be owned by' },
  flows_to: { from: 'flow to', to: 'receive from' },
  replaces: { from: 'replace', to: 'be replaced by' },
};

/** "The new module will still {verb} {otherName}." — one line per relationship the conversion carries over unchanged (`buildConvertSystemToModuleDeltas`'s own module comment: every one of them carries over, nothing is ever dropped). */
export function convertedRelationshipSentence(relationship: ConvertedRelationship, otherName: string): string {
  return `The new module will still ${STILL_VERB[relationship.relationshipType][relationship.side]} ${otherName}.`;
}
