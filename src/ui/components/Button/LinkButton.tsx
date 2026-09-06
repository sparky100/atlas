import type { ComponentProps } from 'react';
import { Link } from 'react-router';
import type { ButtonVariant } from './Button';
import styles from './Button.module.css';

export interface LinkButtonProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
}

/**
 * `Button`'s own styling, on a real `<a>` (react-router's `Link`) instead
 * of a `<button>` — for the zoom chain's "descend a level" links
 * (Context's "Containers →", Container's "Components →", Versions'
 * "Open →"/"Diff →"), all genuine navigation, not a form submit or a
 * JS-only action. Wrapping `Button` in `Link` (an earlier version of this
 * sprint's code did exactly that) nests a `<button>` inside an `<a>` —
 * invalid HTML, and two overlapping interactive elements for a keyboard/
 * screen-reader user to puzzle over. One real link, same look.
 */
export function LinkButton({ variant = 'secondary', className, ...props }: LinkButtonProps) {
  const classes = [styles.button, styles[variant], className].filter(Boolean).join(' ');
  return <Link className={classes} {...props} />;
}
