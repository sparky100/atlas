import type { AiMark } from '../../../engine/elementRead/aiAgent';
import { aiAutonomyLabel, aiShortLabel } from '../../../engine/elementRead/aiAgent';
import { AI_AUTONOMY_TONE } from '../../elements/aiAutonomyTone';
import { Chip } from '../Chip/Chip';
import styles from './AiTag.module.css';

/** The words behind the tag, for hover and screen readers. */
function markLabel(mark: AiMark): string {
  if (mark.autonomy !== null) return `AI agent: ${aiAutonomyLabel(mark.autonomy).toLowerCase()}`;
  return mark.use === 'built_in' ? 'Uses AI: built-in AI features' : 'Uses AI: an AI model or service';
}

/** A small outlined "AI" marker for an agent or any system that uses AI. It has no colour of its own; the words (title and screen-reader label) say which. */
export function AiTag({ mark }: { mark: AiMark }) {
  const label = markLabel(mark);
  return (
    <span className={styles.tag} title={label} aria-label={label}>
      AI
    </span>
  );
}

/** How an agent acts (in the risk tones Criticality uses) or, for any other system using AI, a quiet neutral chip; the words always appear with the tone. */
export function AiMarkChip({ mark }: { mark: AiMark }) {
  return <Chip tone={mark.autonomy !== null ? AI_AUTONOMY_TONE[mark.autonomy] : 'neutral'}>{aiShortLabel(mark)}</Chip>;
}
