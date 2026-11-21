import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import type { DecisionNextStep } from './decisionNextStep';

export interface DecisionNextStepCardProps {
  step: DecisionNextStep;
  onAction: () => void;
  busy: boolean;
  /** Names of the people the handoff went to, once it has been sent. */
  askedNames: readonly string[] | null;
  error: string | null;
  showSecondOpinion?: boolean;
}

/** "What to do next" at the top of a decision: one sentence, one button, for the role of whoever is looking. */
export function DecisionNextStepCard({ step, onAction, busy, askedNames, error, showSecondOpinion = false }: DecisionNextStepCardProps) {
  const asked = step.action === 'ask-to-choose' && askedNames !== null;
  return (
    <Panel>
      <div data-testid="decision-next-step">
        <Text as="h2" size="lg">
          What to do next
        </Text>
        <Text as="p">{step.title}</Text>
        <Text as="p" size="sm" tone="muted">
          {asked ? `Asked ${askedNames.length > 0 ? askedNames.join(', ') : 'the owners and architects'} to choose. Your request is in the comments below.` : step.body}
        </Text>
        {step.actionLabel !== null && !asked && (
          <Button variant="primary" disabled={busy} onClick={onAction}>
            {step.actionLabel}
          </Button>
        )}
        {showSecondOpinion && <Text as="p" size="sm"><a href="#second-opinion">Want a second opinion first?</a></Text>}
        {error !== null && <Text as="p">{error}</Text>}
      </div>
    </Panel>
  );
}
