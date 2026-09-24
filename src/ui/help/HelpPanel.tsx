/**
 * The in-app Help chat panel — opened from `AppHeader`'s own Help button.
 * UI shape ported from Des-Studio's own `src/ui/HelpAssistant.jsx` (a fixed,
 * right-aligned, non-blocking slide-in, not a centred blocking dialog like
 * `UploadCaptureDialog` — a chat you want to reference while the page
 * behind it stays visible), rebuilt with Atlas's own `Panel`/`Button`/
 * `Text` components and CSS-module tokens instead of Des-Studio's inline
 * style objects.
 *
 * State is in-memory only (per Auto Mode's own recorded decision):
 * conversation history is lost on close/reload — no `help_chat_messages`
 * table, no migration. If that turns out to matter in practice, it's an
 * additive follow-up (a new table + RLS + round-trip test, CLAUDE.md rule
 * 1), not a retrofit of this component.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { buildHelpAssistantSystemPrompt, buildHelpUserMessage, type HelpContext } from './helpAssistantPrompt';
import { streamHelpAnswer } from './streamHelpAnswer';
import { DEFAULT_STARTER_PROMPTS } from './starterPrompts';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import styles from './HelpPanel.module.css';

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** `**bold**` only — the one markdown construct the system prompt asks the model to use (`helpAssistantPrompt.ts`'s own "Bold key UI terms" instruction). Anything more (lists, headings) would need a real markdown renderer this feature doesn't need yet. */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}

/** Takes the whole turn as one prop, not spread `role`/`content` — a bare `role` prop on a JSX element trips `jsx-a11y/aria-role` (it can't tell a component prop from the DOM `role` attribute), so `'assistant'`/`'user'` read as invalid ARIA role values even though this isn't a DOM element at all. */
function MessageBubble({ turn }: { turn: ConversationTurn }) {
  const { role, content } = turn;
  const isUser = role === 'user';
  return (
    <div className={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant].join(' ')}>
      <Text size="xs" tone="muted" className={styles.bubbleLabel}>
        {isUser ? 'You' : 'Help'}
      </Text>
      <Text as="div" size="sm">
        {content.split('\n').map((line, i) => (
          <div key={i}>{renderInline(line)}</div>
        ))}
      </Text>
    </div>
  );
}

export interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  /** The current page's own display name, and (for a model-scoped page) coarse counts — never the model's actual data. See `HelpContext`. Explicitly `| undefined` (not just optional) so `AppHeader` can pass its own optional `helpContext` prop straight through under `exactOptionalPropertyTypes` — same convention `Text.tsx`'s own `className` prop comment documents. */
  context?: HelpContext | undefined;
}

export function HelpPanel({ open, onClose, orgId, context = {} }: HelpPanelProps) {
  const [history, setHistory] = useState<ConversationTurn[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, streamingText]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    // Abort an in-flight stream if the panel closes mid-answer — never leave
    // a fetch running against a component that's no longer mounted-visible.
    if (!open) abortRef.current?.abort();
  }, [open]);

  if (!open) return null;

  const submit = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    setInputValue('');
    setError(null);
    setStreamingText('');

    const isFirstTurn = history.length === 0;
    const userContent = buildHelpUserMessage(trimmed, isFirstTurn ? context : {});
    const newHistory: ConversationTurn[] = [...history, { role: 'user', content: trimmed }];
    setHistory(newHistory);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let accumulated = '';

    void streamHelpAnswer(
      {
        orgId,
        messages: [
          { role: 'system', content: buildHelpAssistantSystemPrompt() },
          ...history.map((turn) => ({ role: turn.role, content: turn.content })),
          { role: 'user', content: userContent },
        ],
        signal: controller.signal,
      },
      {
        onToken: (token) => {
          accumulated += token;
          setStreamingText(accumulated);
        },
        onComplete: () => {
          setHistory((prev) => [...prev, { role: 'assistant', content: accumulated }]);
          setStreamingText('');
          setLoading(false);
        },
        onError: (err) => {
          setError(err.message);
          setLoading(false);
        },
      },
    );
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Help" className={styles.panel}>
      <div className={styles.header}>
        <div>
          <Text as="h2" size="md">
            Help
          </Text>
          <Text as="p" size="xs" tone="muted">
            Ask about Atlas or this page
          </Text>
        </div>
        <Button variant="ghost" aria-label="Close Help" onClick={onClose}>
          ✕
        </Button>
      </div>

      <div className={styles.conversation}>
        {history.length === 0 && (
          <div className={styles.starterList}>
            <Text size="xs" tone="muted">
              SUGGESTED QUESTIONS
            </Text>
            {DEFAULT_STARTER_PROMPTS.map((q) => (
              <button key={q} type="button" className={styles.starterButton} onClick={() => { submit(q); }}>
                {q}
              </button>
            ))}
          </div>
        )}

        {history.map((turn, i) => (
          <MessageBubble key={i} turn={turn} />
        ))}
        {streamingText && <MessageBubble turn={{ role: 'assistant', content: streamingText }} />}
        {loading && !streamingText && (
          <Text size="sm" tone="muted">
            Thinking…
          </Text>
        )}
        {error !== null && (
          <Text as="p" size="sm" className={styles.error}>
            {error}
          </Text>
        )}
        <div ref={endRef} />
      </div>

      <div className={styles.inputRow}>
        <textarea
          className={styles.textarea}
          aria-label="Your question"
          rows={2}
          placeholder="Ask a question…"
          value={inputValue}
          disabled={loading}
          onChange={(e) => { setInputValue(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(inputValue);
            }
          }}
        />
        <Button variant="primary" disabled={!inputValue.trim() || loading} onClick={() => { submit(inputValue); }}>
          Send
        </Button>
      </div>
    </div>
  );
}
