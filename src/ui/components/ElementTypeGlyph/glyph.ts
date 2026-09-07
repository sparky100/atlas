import type { ActorSubtype, ElementType } from '../../../contracts/delta';

const GLYPH: Record<ElementType, string> = {
  capability: '◫',
  system: '▣',
  container: '▢',
  component: '▫',
  actor: '◉', // overridden for subtype 'team' below
};

const ACTOR_GLYPH: Record<ActorSubtype, string> = {
  person: '◉',
  team: '◎',
};

/**
 * One fixed glyph per type (§8.5) — there is no icon library and no
 * per-element shape picker (§9 "what we will not build"). This is the only
 * place glyph-per-type mapping is decided; `ElementTypeGlyph` renders it as
 * a `<span>` for DOM contexts, and the landscape canvas renderer (§8.6:
 * Canvas 2D, not DOM, for nodes at scale) calls this directly to draw it
 * with `ctx.fillText` — one definition either way.
 */
export function elementTypeGlyph(type: ElementType, actorSubtype?: ActorSubtype): string {
  return type === 'actor' && actorSubtype ? ACTOR_GLYPH[actorSubtype] : GLYPH[type];
}
