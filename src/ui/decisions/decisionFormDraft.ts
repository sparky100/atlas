import type { UUID } from '../../contracts/delta';
import { PENDING_TTL_MS, type StorageLike } from './pendingOptions';

/**
 * The words a person has typed into a "start a decision" form but not yet
 * started (journey proposal, step 3, continuity). Browser-held, per
 * organisation and per person, and gone after 24 hours, like the suggested
 * options. Nothing is sent to the server until the decision is started.
 */
export interface DecisionFormDraft {
  title: string;
  statement: string;
}

export function decisionFormDraftKey(orgId: UUID, userId: UUID, scope: string): string {
  return `atlas:decision-draft:${orgId}:${userId}:${scope}`;
}

interface Stored extends DecisionFormDraft {
  savedAt: number;
}

export function saveDecisionFormDraft(storage: StorageLike, key: string, draft: DecisionFormDraft, now: number): void {
  if (draft.title.trim() === '' && draft.statement.trim() === '') {
    storage.removeItem(key);
    return;
  }
  const stored: Stored = { ...draft, savedAt: now };
  storage.setItem(key, JSON.stringify(stored));
}

/** The held draft, or null when it is absent, unreadable, empty or older than 24 hours (and then it is removed). */
export function loadDecisionFormDraft(storage: StorageLike, key: string, now: number): DecisionFormDraft | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try {
    const stored = JSON.parse(raw) as Partial<Stored>;
    if (typeof stored.savedAt !== 'number' || now - stored.savedAt > PENDING_TTL_MS || typeof stored.title !== 'string' || typeof stored.statement !== 'string') throw new Error('stale');
    if (stored.title.trim() === '' && stored.statement.trim() === '') throw new Error('empty');
    return { title: stored.title, statement: stored.statement };
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function clearDecisionFormDraft(storage: StorageLike, key: string): void {
  storage.removeItem(key);
}

/** Whether a held draft is worth offering back: it says something the form does not already say. */
export function draftDiffers(held: DecisionFormDraft | null, current: DecisionFormDraft): held is DecisionFormDraft {
  return held !== null && (held.title !== current.title || held.statement !== current.statement);
}
