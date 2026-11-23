import type { ReactNode } from 'react';
import { PageIntro } from '../../components/PageIntro/PageIntro';
import { Text } from '../../components/Text/Text';
import styles from './PlatformAdminPageShell.module.css';

export interface PlatformAdminPageShellProps {
  title: string;
  /** One plain sentence saying what this page shows. */
  intro: string;
  /** Test hook only — never read by application code. */
  testId?: string;
  children: ReactNode;
}

/** The shared heading/intro wrapper for one platform-admin area. */
export function PlatformAdminPageShell({ title, intro, testId, children }: PlatformAdminPageShellProps) {
  return (
    <section className={styles.page} data-testid={testId}>
      <Text as="h1" size="2xl">
        {title}
      </Text>
      <PageIntro>{intro}</PageIntro>
      {children}
    </section>
  );
}
