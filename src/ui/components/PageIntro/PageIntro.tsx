import { Text } from '../Text/Text';
import styles from './PageIntro.module.css';

/** One plain sentence under a page title saying what the page is for. Used by the Work pages so the three kinds of work (decision, change, project) are always explained where they are met. */
export function PageIntro({ children }: { children: string }) {
  return (
    <div className={styles.intro}>
      <Text as="p" size="sm" tone="muted">
        {children}
      </Text>
    </div>
  );
}
