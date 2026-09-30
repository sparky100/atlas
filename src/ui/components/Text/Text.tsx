import type { ElementType, ReactNode } from 'react';
import styles from './Text.module.css';

export type TextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
export type TextTone = 'default' | 'muted' | 'faint';

export interface TextProps {
  /** Which type-scale step (§8.1) — the only sizes that exist in this product; there is no arbitrary font-size prop. */
  size?: TextSize;
  tone?: TextTone;
  /** Renders in the monospace stack (§8.1) — ids, `source_ref`, hashes. */
  mono?: boolean;
  /** The rendered element. Defaults to `span`; pass `h1`/`p`/etc. for real document structure — Text never decides semantics for you. */
  as?: ElementType;
  // Explicitly `| undefined` (not just optional) so callers can pass a CSS
  // Modules lookup straight through — those type as `string | undefined`
  // under noUncheckedIndexedAccess, and exactOptionalPropertyTypes treats
  // "optional" and "may be undefined" as different things.
  className?: string | undefined;
  /** The rendered element's own `id`, when something must reference it (`aria-describedby` wiring, e.g. `AttributeEditRow`'s field help text). Absent everywhere else. */
  id?: string | undefined;
  children: ReactNode;
}

/**
 * The one place font-size/line-height/colour tone are chosen from — every
 * other component composes this rather than setting its own `font-size`.
 * Deliberately narrow: no arbitrary size, weight or colour props, so the
 * type scale in tokens.css stays the only scale in the product (§8.1).
 */
export function Text({ size = 'md', tone = 'default', mono = false, as: Component = 'span', className, id, children }: TextProps) {
  const classes = [styles.text, styles[`size-${size}`], styles[`tone-${tone}`], mono ? styles.mono : '', className].filter(Boolean).join(' ');
  return (
    <Component className={classes} id={id}>
      {children}
    </Component>
  );
}
