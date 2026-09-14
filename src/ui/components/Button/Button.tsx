import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
}

/**
 * The only button in the product. `Approve`/`Merge` (SPEC §7.4, review-
 * queue) are the rare, consequential actions this maps to `primary`;
 * everything reachable by a single key (§5.2, §8.8) is `secondary`/`ghost`,
 * because a keyboard-first surface shouldn't visually shout about actions
 * that are one keypress away.
 *
 * `destructive` is its own tier, not a colour swap on `secondary` (UI-
 * principles §8.10, found in a walkthrough — the "Cancel this change…"
 * flow used to render as `ghost`, reading as plain text with no warning
 * at all): outlined in `--status-danger`, for an action that removes,
 * retracts, cancels or deletes something — never rendered as plain text
 * or a `ghost` button, so a reader can tell at a glance which controls on
 * a page are safe to explore and which one to read carefully first.
 */
export function Button({ variant = 'secondary', type = 'button', ...props }: ButtonProps) {
  const classes = [styles.button, styles[variant]].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...props} />;
}
