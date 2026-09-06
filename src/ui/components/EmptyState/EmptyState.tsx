import type { ReactNode } from 'react';
import { Text } from '../Text/Text';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  children: ReactNode;
}

/**
 * A designed empty state, not a blank section (UI-principles §4.9: "No
 * decisions recorded about this system. 2 in-flight changes touch it
 * without a linked decision" is the model — never just "No decisions").
 * Callers write the specific, informative sentence; this only supplies
 * the consistent presentation.
 */
export function EmptyState({ children }: EmptyStateProps) {
  return (
    <Text as="p" tone="muted" className={styles.text}>
      {children}
    </Text>
  );
}
