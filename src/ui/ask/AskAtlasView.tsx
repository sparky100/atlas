import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { AskResult } from '../../tools/askLoop';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { answerBlocks, type AnswerPart } from './answerBlocks';
import { askStepLabel } from './askStepLabels';
import { useAskAtlas, type AskStep, type AskTurnState } from './useAskAtlas';
import styles from './AskAtlasView.module.css';

export interface AskAtlasViewProps {
  modelId: UUID;
  basePath: string;
  orgSlug: string;
  /** The model's organisation has switched Ask Atlas on. */
  enabled: boolean;
  isOwner: boolean;
}

const STARTERS = ['Which systems are critical?', 'Which systems are past or near the end of support?', 'What data-quality findings need attention?'];

/** ADR-028 §8: the Ask Atlas page body. The conversation is in memory only; reloading clears it. */
export function AskAtlasView({ modelId, basePath, orgSlug, enabled, isOwner }: AskAtlasViewProps) {
  const { turns, busy, ask, clear } = useAskAtlas(enabled ? modelId : null);
  const [draft, setDraft] = useState('');
  const inputId = useId();

  if (!enabled) {
    return (
      <Panel>
        <Text as="h2" size="lg">
          Ask Atlas is off for this organisation
        </Text>
        <Text as="p">
          When it is on, the questions members ask, and the names, descriptions, attributes and relationships of the elements needed to answer them, are sent to our AI provider to produce each answer. The same setting covers Draft with AI on the Changes page. Nothing is sent while it is off.
        </Text>
        {isOwner ? (
          <Text as="p">
            You can switch it on in <Link to={`/o/${orgSlug}/settings`}>organisation settings</Link>.
          </Text>
        ) : (
          <Text as="p">Ask an owner of this organisation to switch it on.</Text>
        )}
      </Panel>
    );
  }

  const submit = (question: string) => {
    if (busy || question.trim() === '') return;
    setDraft('');
    void ask(question);
  };

  return (
    <div className={styles.layout}>
      <Text as="p" tone="muted">
        Ask about this model. Answers come only from what is looked up, and every element named links to its page. Read-only: Ask Atlas cannot change anything. Questions and results are sent to our AI provider; nothing is saved when you leave this page.
      </Text>

      {turns.length === 0 && (
        <div className={styles.starters}>
          {STARTERS.map((starter) => (
            <Button
              key={starter}
              variant="secondary"
              onClick={() => {
                submit(starter);
              }}
            >
              {starter}
            </Button>
          ))}
        </div>
      )}

      {turns.map((turn) => (
        <TurnView key={turn.id} turn={turn} basePath={basePath} />
      ))}

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <textarea
          id={inputId}
          aria-label="Your question"
          className={styles.input}
          rows={2}
          maxLength={2000}
          placeholder="Ask a question about this model…"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(draft);
            }
          }}
        />
        <Button variant="primary" type="submit" disabled={busy || draft.trim() === ''}>
          {busy ? 'Asking…' : 'Ask'}
        </Button>
        {turns.length > 0 && (
          <Button variant="ghost" onClick={clear} disabled={busy}>
            Clear
          </Button>
        )}
      </form>
    </div>
  );
}

function TurnView({ turn, basePath }: { turn: AskTurnState; basePath: string }) {
  return (
    <Panel>
      <div className={styles.turn}>
        <Text as="p" className={styles.question}>
          {turn.question}
        </Text>
        {turn.status === 'asking' && (
          <div role="status">
            <Text as="p" tone="muted">
              {turn.steps.length === 0 ? 'Thinking…' : `${askStepLabel(turn.steps[turn.steps.length - 1]?.name ?? '')}…`}
            </Text>
          </div>
        )}
        {turn.status === 'answered' && <Answer result={turn.outcome.result} basePath={basePath} />}
        {turn.status === 'refused' && <Text as="p">{refusalText(turn.reason, turn.message)}</Text>}
        {turn.status === 'failed' && (
          <div role="alert">
            <Text as="p">{turn.code === 'rate_limited' ? `${turn.message} Try again later.` : `Ask Atlas could not answer. ${turn.message}`}</Text>
          </div>
        )}
        {turn.status === 'answered' ? <Steps steps={turn.outcome.result.toolUses} /> : turn.steps.length > 0 && <StepNames steps={turn.steps} />}
      </div>
    </Panel>
  );
}

function refusalText(reason: 'disabled' | 'not_found' | 'empty_model' | 'invalid', message: string): string {
  if (reason === 'disabled') return 'Ask Atlas has been switched off for this organisation.';
  if (reason === 'not_found') return "This model doesn't exist, or you can't see it.";
  if (reason === 'empty_model') return 'This model has nothing in it yet, so there is nothing to ask about.';
  return message || 'That question could not be sent.';
}

function Answer({ result, basePath }: { result: AskResult; basePath: string }) {
  const blocks = answerBlocks(result.answer);
  const renderParts = (parts: AnswerPart[]) =>
    parts.map((part, i) =>
      part.kind === 'text' ? (
        <span key={i}>{part.text}</span>
      ) : (
        <Link key={i} to={`${basePath}/e/${part.id}`}>
          {result.citationNames[part.id] ?? 'element'}
        </Link>
      ),
    );
  const items = (start: number) => {
    const out: AnswerPart[][] = [];
    for (let i = start; i < blocks.length && blocks[i]?.kind === 'item'; i += 1) out.push(blocks[i]?.parts ?? []);
    return out;
  };

  const rendered: React.ReactNode[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (!block) continue;
    if (block.kind === 'paragraph') {
      rendered.push(<p key={i}>{renderParts(block.parts)}</p>);
    } else {
      const list = items(i);
      rendered.push(
        <ul key={i}>
          {list.map((parts, j) => (
            <li key={j}>{renderParts(parts)}</li>
          ))}
        </ul>,
      );
      i += list.length - 1;
    }
  }

  return (
    <>
      <div className={styles.answer}>{rendered.length > 0 ? rendered : <EmptyState>Ask Atlas gave no answer.</EmptyState>}</div>
      <div className={styles.chips}>
        {result.status === 'incomplete' && <Chip tone="warn">Incomplete{result.limit ? ': a lookup limit was reached' : ''}</Chip>}
        {result.status === 'refused' && <Chip tone="warn">The AI service declined to answer</Chip>}
        {result.status !== 'refused' && !result.grounded && <Chip tone="warn">Ungrounded: no element is cited</Chip>}
        {result.unverifiedRemoved > 0 && <Chip tone="danger">Contains an unverified reference (removed)</Chip>}
      </div>
    </>
  );
}

function Steps({ steps }: { steps: AskResult['toolUses'] }) {
  if (steps.length === 0) return null;
  return (
    <details>
      <summary>
        <Text as="span" size="sm" tone="muted">
          What was looked up ({steps.length})
        </Text>
      </summary>
      <ol className={styles.steps}>
        {steps.map((step, i) => (
          <li key={i}>
            <Text as="span" size="sm">
              {askStepLabel(step.name)}
              {step.ok ? (step.total === null ? '' : `: ${String(step.total)} found${step.truncated ? ' (list cut short)' : ''}`) : ': failed'}
            </Text>
            <Text as="span" size="xs" tone="muted" className={styles.stepDetail}>
              {step.error ?? JSON.stringify(step.input)}
            </Text>
          </li>
        ))}
      </ol>
    </details>
  );
}

function StepNames({ steps }: { steps: AskStep[] }) {
  return (
    <Text as="p" size="sm" tone="muted">
      {steps.map((s) => askStepLabel(s.name)).join(' · ')}
    </Text>
  );
}
