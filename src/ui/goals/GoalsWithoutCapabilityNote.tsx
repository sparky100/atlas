import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Text } from '../components/Text/Text';
import { countGoalsWithoutCapability, countText } from './goalModel';
import { useModelGoals } from './useModelGoals';

/** The homes' one-line count of active goals that no capability serves yet, linking to the Goals page. Shown only when there is at least one: a plain number, never a score. */
export function GoalsWithoutCapabilityNote({ modelId, goalsHref }: { modelId: UUID; goalsHref: string }) {
  const state = useModelGoals(modelId);
  if (state === null) return null;
  const count = countGoalsWithoutCapability(state.goals, state.links);
  if (count === 0) return null;
  return (
    <Text as="p" size="sm">
      {countText(count, 'goal has', 'goals have')} no capability linked yet. <Link to={goalsHref}>Link capabilities on Goals →</Link>
    </Text>
  );
}
