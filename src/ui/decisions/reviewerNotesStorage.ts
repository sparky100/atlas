import type { UUID } from '../../contracts/delta';
import type { ReviewNote } from '../../tools/reviewHandler';
import type { ReviewLens } from '../../tools/reviewPrompt';
import type { StorageLike } from './pendingOptions';

export const REVIEW_NOTES_TTL_MS = 24 * 60 * 60 * 1000;

export interface HeldQuestion extends ReviewNote {
  suggestedQuestion: string;
}

export interface HeldReview {
  lens: ReviewLens;
  notes: HeldQuestion[];
  inputHash: string;
  runId: string;
  inputTokens: number;
  outputTokens: number;
  savedAt: number;
}

export function reviewStorageKey(orgId: UUID, userId: UUID, decisionId: UUID): string {
  return `atlas:second-opinions:${orgId}:${userId}:${decisionId}`;
}

function isLens(value: unknown): value is ReviewLens { return value === 'challenge' || value === 'cyber' || value === 'data'; }

export function loadHeldReviews(storage: StorageLike, key: string, now: number): HeldReview[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('bad data');
    return parsed.filter((item): item is HeldReview => {
      if (!item || typeof item !== 'object') return false;
      const r = item as Partial<HeldReview>;
      return isLens(r.lens) && typeof r.savedAt === 'number' && now >= r.savedAt && now - r.savedAt < REVIEW_NOTES_TTL_MS && typeof r.inputHash === 'string' && typeof r.runId === 'string' && typeof r.inputTokens === 'number' && typeof r.outputTokens === 'number' && Array.isArray(r.notes) && r.notes.length <= 5 && r.notes.every((n) => typeof n.note === 'string' && typeof n.question === 'string' && typeof n.suggestedQuestion === 'string' && typeof n.basedOn.label === 'string');
    });
  } catch {
    try { storage.removeItem(key); } catch { /* Storage can be disabled entirely. */ }
    return [];
  }
}

export function saveHeldReviews(storage: StorageLike, key: string, reviews: readonly HeldReview[]): void {
  try {
    if (reviews.length) storage.setItem(key, JSON.stringify(reviews));
    else storage.removeItem(key);
  } catch { /* Private browsing may refuse storage; the current page still keeps its notes. */ }
}

/** A marker only for a request abandoned by navigation, never for a completed or stopped request. */
export function interruptedReview(storage: StorageLike, key: string, now: number): boolean {
  try {
    const started = Number(storage.getItem(`${key}:running`));
    if (!Number.isFinite(started) || started <= 0) return false;
    storage.removeItem(`${key}:running`);
    return now - started < REVIEW_NOTES_TTL_MS;
  } catch { return false; }
}
