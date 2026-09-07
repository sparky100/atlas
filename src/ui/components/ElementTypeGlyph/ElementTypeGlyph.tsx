import type { ActorSubtype, ElementType } from '../../../contracts/delta';
import { elementTypeGlyph } from './glyph';
import styles from './ElementTypeGlyph.module.css';

export interface ElementTypeGlyphProps {
  type: ElementType;
  /** Required when `type === 'actor'` (§8.5: person vs. team have distinct glyphs); ignored otherwise. */
  actorSubtype?: ActorSubtype;
  /** Dotted outline (§8.5) — System/Container/Actor's `is_external` flag. */
  external?: boolean;
  /** Screen-reader label. Defaults to the type name; pass the element's own name for a more useful announcement in context. */
  label?: string;
}

/**
 * One fixed glyph per type (§8.5) — there is no icon library and no
 * per-element shape picker (§9 "what we will not build"). This is the only
 * place glyph-per-type mapping is decided; breadcrumbs, canvas nodes,
 * lists and badges all render through this component or its sibling
 * `elementTypeGlyph()` function.
 */
export function ElementTypeGlyph({ type, actorSubtype, external = false, label }: ElementTypeGlyphProps) {
  const glyph = elementTypeGlyph(type, actorSubtype);
  const accessibleLabel = label ?? (type === 'actor' && actorSubtype ? actorSubtype : type);
  const classes = [styles.glyph, external ? styles.external : ''].filter(Boolean).join(' ');
  return (
    <span className={classes} role="img" aria-label={accessibleLabel}>
      {glyph}
    </span>
  );
}
