import { useRef, useState } from 'react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { parseMentionHandles } from '../../../contracts/comments';
import type { ProfileRow } from '../../../db/types';
import { activeMentionQuery, insertMention } from '../../comments/mentionAutocomplete';
import { Avatar } from '../Avatar/Avatar';
import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import styles from './CommentComposer.module.css';

export interface CommentComposerProps {
  /** Every fellow org member — the autocomplete's own candidate list (`useOrgMemberProfiles`), filtered locally as someone types. */
  members: readonly ProfileRow[];
  onSubmit: (body: string) => Promise<void>;
  /** Only for a reply/edit composer nested inside a thread — a new-thread composer has nothing to cancel back to. */
  onCancel?: () => void;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
}

/**
 * The one composer, reused everywhere a body gets typed (Sprint M1b,
 * `docs/HANDOFF-M1b-comments.md`): a new thread, a reply, the canvas
 * panel, the change page's own per-anchor column. `@mentions render as
 * accent-weighted text` is the read side (`CommentBody`, not this
 * component); this is only the write side — autocomplete, the "will
 * notify" preview, and `⌘/Ctrl+Enter` to post.
 */
export function CommentComposer({ members, onSubmit, onCancel, placeholder = 'Write a comment…', submitLabel = 'Post', autoFocus = false }: CommentComposerProps) {
  const [body, setBody] = useState('');
  const [cursorIndex, setCursorIndex] = useState(0);
  const [status, setStatus] = useState<'idle' | 'submitting'>('idle');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mentionQuery = activeMentionQuery(body, cursorIndex);
  const suggestions = mentionQuery === null ? [] : members.filter((m) => m.handle.startsWith(mentionQuery.toLowerCase())).slice(0, 6);

  const mentionedHandles = parseMentionHandles(body);
  const notifiedMembers = members.filter((m) => mentionedHandles.includes(m.handle));

  /** Refs are read in event handlers, never during render (react-hooks/refs) — this is the one place the textarea's own live selection is read, always from inside a real DOM event. */
  function trackCursor(e: SyntheticEvent<HTMLTextAreaElement>) {
    setCursorIndex(e.currentTarget.selectionStart);
  }

  function pickSuggestion(handle: string) {
    const insertion = insertMention(body, cursorIndex, handle);
    setBody(insertion.body);
    setCursorIndex(insertion.cursorIndex);
    // Restore focus and move the caret past the inserted mention — a
    // plain setState re-render doesn't move a textarea's own selection.
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(insertion.cursorIndex, insertion.cursorIndex);
    });
  }

  async function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0 || status === 'submitting') return;
    setStatus('submitting');
    setError(null);
    try {
      await onSubmit(trimmed);
      setBody('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post the comment.');
    } finally {
      setStatus('idle');
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className={styles.composer}>
      <div className={styles.inputWrapper}>
        <textarea
          ref={textareaRef}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- opt-in per caller (a reply's own "Reply" button is itself the request to type one; a page-level composer follows its own surface's convention).
          autoFocus={autoFocus}
          className={styles.textarea}
          placeholder={placeholder}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            trackCursor(e);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={trackCursor}
          onClick={trackCursor}
          onSelect={trackCursor}
          disabled={status === 'submitting'}
        />
        {suggestions.length > 0 && (
          <ul className={styles.suggestions} role="listbox">
            {suggestions.map((member) => (
              <li key={member.user_id}>
                <button type="button" className={styles.suggestion} onClick={() => { pickSuggestion(member.handle); }}>
                  <Avatar profile={member} size="sm" />
                  <Text as="span" size="sm">
                    {member.display_name ?? member.handle}
                  </Text>
                  <Text as="span" size="xs" tone="muted">
                    @{member.handle}
                  </Text>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {notifiedMembers.length > 0 && (
        <Text as="p" size="xs" tone="faint">
          Will notify: {notifiedMembers.map((m) => `@${m.handle}`).join(', ')}
        </Text>
      )}

      <div className={styles.actions}>
        <Button variant="primary" disabled={status === 'submitting' || body.trim().length === 0} onClick={() => void submit()}>
          {status === 'submitting' ? 'Posting…' : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" type="button" onClick={onCancel} disabled={status === 'submitting'}>
            Cancel
          </Button>
        )}
      </div>

      {error !== null && (
        <Text as="p" size="sm">
          {error}
        </Text>
      )}
    </div>
  );
}
