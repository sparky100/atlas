import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
}

/**
 * The only button in the product. `Approve`/`Merge` (SPEC §7.4, review-
 * queue) are the rare, consequential actions this maps to `primary`;
 * everything reachable by a single key (§5.2, §8.8) is `secondary`/`ghost`,
 * because a keyboard-first surface shouldn't visually shout about actions
 * that are one keypress away.
 */
export function Button({ variant = 'secondary', type = 'button', ...props }: ButtonProps) {
  const classes = [styles.button, styles[variant]].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...props} />;
}
