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
  className?: string;
  children: ReactNode;
}

/**
 * The one place font-size/line-height/colour tone are chosen from — every
 * other component composes this rather than setting its own `font-size`.
 * Deliberately narrow: no arbitrary size, weight or colour props, so the
 * type scale in tokens.css stays the only scale in the product (§8.1).
 */
export function Text({ size = 'md', tone = 'default', mono = false, as: Component = 'span', className, children }: TextProps) {
  const classes = [styles.text, styles[`size-${size}`], styles[`tone-${tone}`], mono ? styles.mono : '', className].filter(Boolean).join(' ');
  return <Component className={classes}>{children}</Component>;
}
