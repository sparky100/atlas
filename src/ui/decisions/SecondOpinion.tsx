import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { keepDecisionAgentNote } from '../../db/decisionAgentNotes';
import { runReviewer } from '../../db/reviewAgent';
import type { ReviewLens } from '../../tools/reviewPrompt';
import { Button } from '../components/Button/Button';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import type { ReviewerAvailability } from './reviewerAvailability';
import { interruptedReview, loadHeldReviews, reviewStorageKey, saveHeldReviews, type HeldQuestion, type HeldReview } from './reviewerNotesStorage';
import styles from './SecondOpinion.module.css';

const LENSES: readonly { lens: ReviewLens; button: string; name: string }[] = [
  { lens: 'challenge', button: 'Ask the Challenger', name: 'Challenger' },
  { lens: 'cyber', button: 'Ask the Steward: cyber', name: 'Steward: cyber' },
  { lens: 'data', button: 'Ask the Steward: data', name: 'Steward: data' },
];
const now = () => Date.now();

export function SecondOpinion({ orgId, userId, decisionId, orgSlug, shareCost, availability }: { orgId: UUID; userId: UUID | null; decisionId: UUID; orgSlug: string; shareCost: boolean; availability: ReviewerAvailability }) {
  const key = reviewStorageKey(orgId, userId ?? '', decisionId);
  const [reviews, setReviews] = useState<HeldReview[]>(() => loadHeldReviews(localStorage, key, Date.now()));
  const [interrupted, setInterrupted] = useState(() => interruptedReview(sessionStorage, key, Date.now()));
  const [running, setRunning] = useState<ReviewLens | null>(null);
  // Set only when a run completes in this mount. The marker is cleared in a
  // committed effect, never in `finally`: a reload aborts the request, and
  // clearing there would erase the very marker the next page needs to say the
  // run did not finish.
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState<{ kind: 'failed' | 'stopped'; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Note ids (runId:index) already kept on this page, so the button reads "Kept".
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [keeping, setKeeping] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const abort = useRef<AbortController | null>(null);
  const runNo = useRef(0);

  useEffect(() => { saveHeldReviews(localStorage, key, reviews); }, [key, reviews]);
  useEffect(() => {
    if (!completed) return;
    try { sessionStorage.removeItem(`${key}:running`); } catch { /* Storage may be unavailable. */ }
  }, [key, completed]);
  useEffect(() => () => { runNo.current += 1; abort.current?.abort(); }, []);

  async function ask(lens: ReviewLens) {
    if (!availability.available || userId === null || running !== null) return;
    const mine = ++runNo.current;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(lens);
    setMessage(null);
    setInterrupted(false);
    setCompleted(false);
    try { sessionStorage.setItem(`${key}:running`, String(now())); } catch { /* The page still works without the return marker. */ }
    try {
      const result = await runReviewer(supabase, decisionId, lens, controller.signal);
      if (mine !== runNo.current) return;
      const review: HeldReview = { lens, notes: result.notes.map((n) => ({ ...n, suggestedQuestion: n.question })), inputHash: result.inputHash, runId: result.runId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, savedAt: now() };
      setReviews((old) => [...old.filter((r) => r.lens !== lens), review]);
      setCompleted(true);
    } catch (e) {
      if (mine !== runNo.current) return;
      // A failed or aborted run keeps the marker: the page may be reloading,
      // and the next page must be able to say the run did not finish. A new
      // ask overwrites it; a successful run clears it (the effect above).
      setMessage({ kind: 'failed', text: e instanceof Error ? e.message : 'The second opinion could not be completed. Try again.' });
    } finally {
      if (mine === runNo.current) {
        setRunning(null);
        abort.current = null;
      }
    }
  }

  function stop() {
    runNo.current += 1;
    abort.current?.abort();
    abort.current = null;
    try { sessionStorage.removeItem(`${key}:running`); } catch { /* Storage may be unavailable. */ }
    setRunning(null);
    setMessage({ kind: 'stopped', text: 'Stopped waiting. Nothing from this run was kept. The request may already be with the AI provider and may still use tokens; an owner can see usage in organisation settings.' });
  }

  function updateQuestion(lens: ReviewLens, index: number, question: string) {
    setReviews((old) => old.map((r) => r.lens === lens ? { ...r, notes: r.notes.map((n, i) => i === index ? { ...n, question } : n) } : r));
  }

  function dismiss(lens: ReviewLens, index: number) {
    setReviews((old) => old.map((r) => r.lens === lens ? { ...r, notes: r.notes.filter((_, i) => i !== index) } : r).filter((r) => r.notes.length > 0));
  }

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
    } catch { setMessage({ kind: 'failed', text: 'Could not copy the question. You can select its text and copy it.' }); }
  }

  async function keep(review: HeldReview, note: HeldQuestion, index: number) {
    if (userId === null || keeping !== null) return;
    const id = `${review.runId}:${String(index)}`;
    setKeeping(id);
    setMessage(null);
    try {
      await keepDecisionAgentNote(supabase, {
        decisionId,
        branchId: note.basedOn.kind === 'option' && note.basedOn.branchId !== undefined ? note.basedOn.branchId : null,
        lens: review.lens,
        suggestedQuestion: note.suggestedQuestion,
        question: note.question.trim(),
        basedOn: note.basedOn.kind,
        basedOnLabel: note.basedOn.kind === 'none' ? null : note.basedOn.label,
        inputHash: review.inputHash,
        runId: review.runId,
        keptBy: userId,
      });
      setKept((old) => new Set(old).add(id));
      await queryClient.invalidateQueries({ queryKey: ['decisionAgentNotes', decisionId] });
    } catch (e) {
      setMessage({ kind: 'failed', text: e instanceof Error ? e.message : 'Could not keep this question. Try again.' });
    } finally {
      setKeeping(null);
    }
  }

  return (
    <Panel data-testid="second-opinion">
      <section id="second-opinion">
        <CollapsibleSection
          title="Second opinion"
          meta={reviews.length > 0 ? `${String(reviews.reduce((n, r) => n + r.notes.length, 0))} question(s) held` : undefined}
          defaultOpen
        >
        <Text as="p">Ask what might be missing before a person chooses. These are AI questions for you to weigh, not a review, clearance or sign-off.</Text>
        <Text as="p" size="sm" tone="muted">The decision as it stands now (context, options, ratings, principles and visible changes) goes to your organisation's AI provider when you ask. Nothing you are still typing is sent.</Text>
        <details className={styles.details}>
          <summary>What is sent to the AI?</summary>
          <ul>
            <li>The decision's title and context as they stand now, dates, linked capability and system names, and option titles and descriptions.</li>
            <li>Ratings and their notes, principles, goals, visible “What changes” rows, and direct estate facts about the named systems.</li>
            <li>{shareCost ? 'Your owner has allowed the Cost rating and Run cost row to be shared.' : 'Cost rating and Run cost are withheld. Obvious amounts of money in the decision block the request, but this check cannot find every cost reference.'}</li>
          </ul>
          <Text as="p" size="sm">People's names, comments, approvals and frozen packs are not sent. Pasted source lines in an option description are sent as part of that text.</Text>
        </details>
        {!availability.available && <div data-testid="second-opinion-unavailable"><Text as="p" size="sm">{availability.reason} {availability.canFix && <Link to={`/o/${orgSlug}/settings`}>Open organisation settings</Link>}</Text></div>}
        {availability.available && (
          <>
            <div className={styles.actions}>
              {LENSES.map(({ lens, button }) => <Button key={lens} variant="secondary" disabled={running !== null} onClick={() => { void ask(lens); }}>{button}</Button>)}
            </div>
            {running !== null && <div role="status" className={styles.progress}><Text as="p">The {LENSES.find((l) => l.lens === running)?.name} is reading the decision as it stands. This may take a while. You can stop waiting.</Text><Button onClick={stop}>Stop waiting</Button></div>}
          </>
        )}
        {interrupted && <div role="status"><Text as="p">That run did not finish on this page. Ask again. Earlier questions are still here.</Text></div>}
        {message && <div role={message.kind === 'failed' ? 'alert' : 'status'}><Text as="p">{message.text} {message.kind === 'failed' ? 'Earlier questions are still here; you can try again.' : ''}</Text></div>}
        {reviews.map((review) => {
          const name = LENSES.find((l) => l.lens === review.lens)?.name ?? 'Reviewer';
          return <div key={review.lens} className={styles.review} data-testid={`review-${review.lens}`}>
            <Text as="h3" size="md">Drafted by the {name} (AI), for a person to weigh</Text>
            {review.notes.length === 0 ? <Text as="p">Nothing to add. That does not mean it is cleared.</Text> : <ol className={styles.notes}>{review.notes.map((note, index) => {
              const id = `${review.runId}:${String(index)}`;
              return <li key={id} className={styles.note}>
                <Text as="p">{note.note}</Text>
                <Text as="p" size="sm" tone="muted">Based on: {note.basedOn.label}</Text>
                <label className={styles.question}>Question for you to act on
                  <textarea value={note.question} maxLength={500} onChange={(e) => { updateQuestion(review.lens, index, e.target.value); }} />
                </label>
                <div className={styles.noteActions}>
                  <Button disabled={note.question.trim() === ''} onClick={() => { void copy(note.question.trim(), id); }}>{copied === id ? 'Copied' : 'Copy question'}</Button>
                  <Button disabled={note.question.trim() === '' || keeping === id} onClick={() => { void keep(review, note, index); }}>{kept.has(id) ? 'Kept' : keeping === id ? 'Keeping…' : 'Keep this question'}</Button>
                  <Button variant="ghost" onClick={() => { dismiss(review.lens, index); }}>Dismiss</Button>
                </div>
              </li>;
            })}</ol>}
            <Text as="p" size="sm" tone="muted">These questions reflect the decision as it stood when you asked. Ask again after changing it. This run used about {(review.inputTokens + review.outputTokens).toLocaleString('en-GB')} tokens. Held on this device only, not for the team; expires after 24 hours. A question you keep is saved to the decision.</Text>
          </div>;
        })}
        </CollapsibleSection>
      </section>
    </Panel>
  );
}
