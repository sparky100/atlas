import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import type { DecisionFormDraft } from './decisionFormDraft';
import styles from './DecisionDraftBanner.module.css';

/** Offers back words typed earlier into a decision form that was never started. */
export function DecisionDraftBanner({ draft, onRestore, onDiscard }: { draft: DecisionFormDraft; onRestore: (draft: DecisionFormDraft) => void; onDiscard: () => void }) {
  const what = draft.title.trim() !== '' ? `“${draft.title.trim()}”` : 'what you wrote';
  return (
    <div className={styles.banner} role="status" data-testid="decision-draft-restore">
      <Text as="span" size="sm">You have an unfinished decision from earlier: {what}. It is kept in this browser for 24 hours and was not saved to Atlas.</Text>
      <Button type="button" variant="secondary" onClick={() => { onRestore(draft); }}>Restore it</Button>
      <Button type="button" variant="secondary" onClick={onDiscard}>Discard it</Button>
    </div>
  );
}
