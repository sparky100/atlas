import type { ReactNode } from 'react';
import { Text } from '../Text/Text';
import styles from './PageIdentity.module.css';

/**
 * The type of work and its name, at the top of a work page. The three work
 * pages (decision, change, project) carry the same eyebrow so it is always
 * clear which kind of thing you are looking at; the page's own status chip
 * stays with the page, immediately below this header.
 */
export function PageIdentity({ kind, name, actions }: { kind: 'Decision' | 'Change' | 'Project'; name: string; actions?: ReactNode }) {
  return (
    <div className={styles.identity}>
      <Text as="p" size="xs" tone="muted" className={styles.kind}>
        {kind}
      </Text>
      <div className={styles.titleRow}>
        <Text as="h1" size="2xl">
          {name}
        </Text>
        {actions}
      </div>
    </div>
  );
}
