import type { AiAutonomy } from '../../../contracts/delta';
import { aiAutonomyLabel } from '../../../engine/elementRead/aiAgent';
import { AI_AUTONOMY_TONE } from '../../elements/aiAutonomyTone';
import { Chip } from '../Chip/Chip';
import styles from './AiAgentTag.module.css';

/** A small outlined "AI" marker. The words (title and screen-reader label) say how the agent acts. */
export function AiAgentTag({ autonomy }: { autonomy: AiAutonomy }) {
  const label = `AI agent: ${aiAutonomyLabel(autonomy).toLowerCase()}`;
  return (
    <span className={styles.tag} title={label} aria-label={label}>
      AI
    </span>
  );
}

/** How the agent acts, as a chip in the risk tones above; the words always appear with the tone. */
export function AiAutonomyChip({ autonomy }: { autonomy: AiAutonomy }) {
  return <Chip tone={AI_AUTONOMY_TONE[autonomy]}>{aiAutonomyLabel(autonomy)}</Chip>;
}
