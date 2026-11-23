import type { UUID } from '../../contracts/delta';
import { citationsToNames } from '../../db/designAgent';
import { parseCatalogueProducts, type DesignerCatalogueProduct } from '../../contracts/designerOptions';
import { catalogueCitationSchema, type CatalogueCitation } from '../../contracts/productCatalogue';

/**
 * Suggested options a person has chosen to carry into a decision, held until
 * each one is saved (journey proposal, continuity). Browser-held, per
 * organisation and per person, and they expire after 24 hours, so a draft is
 * not kept indefinitely on a shared machine. Nothing is stored on the server
 * until an option is actually added. Pure apart from the storage handle it is
 * given.
 *
 * `id` is created when the card is made and becomes the option's branch id,
 * so adding the same option twice (a retry, a double click) can never create a
 * second one.
 */
export interface PendingOption {
  id: UUID;
  title: string;
  summary: string;
  toWeigh: string;
  /** What the Designer actually said, kept for the option's mark. */
  suggestedTitle: string;
  suggestedSummary: string;
  draftedAt: string;
  /** Reviewed catalogue products the Designer read for this option. Saved as citations when the option is added. */
  catalogueRefs: CatalogueCitation[];
  /** The same products in display form, so a card can show names, vendors and claims. */
  catalogueProducts?: DesignerCatalogueProduct[];
}

export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/** Never show an element id. Old held drafts may still contain [[element:<id>]]; the name is gone, so use the same honest fallback as the Designer. */
function clean(value: unknown): string {
  return typeof value === 'string' ? citationsToNames(value, {}) : '';
}

function sanitiseOption(option: PendingOption): PendingOption {
  return {
    ...option,
    title: clean(option.title),
    summary: clean(option.summary),
    toWeigh: clean(option.toWeigh),
    suggestedTitle: clean(option.suggestedTitle),
    suggestedSummary: clean(option.suggestedSummary),
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function pendingKey(orgId: UUID, userId: UUID, decisionId: UUID): string {
  return `atlas:pending-options:${orgId}:${userId}:${decisionId}`;
}

interface Stored {
  savedAt: number;
  options: PendingOption[];
}

export function savePending(storage: StorageLike, key: string, options: readonly PendingOption[], now: number): void {
  if (options.length === 0) {
    storage.removeItem(key);
    return;
  }
  const stored: Stored = { savedAt: now, options: options.map(sanitiseOption) };
  storage.setItem(key, JSON.stringify(stored));
}

/** What is still waiting to be saved, or nothing when it is absent, unreadable or older than 24 hours (and then it is removed). */
export function loadPending(storage: StorageLike, key: string, now: number): PendingOption[] {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  try {
    const stored = JSON.parse(raw) as Partial<Stored>;
    if (typeof stored.savedAt !== 'number' || now - stored.savedAt > PENDING_TTL_MS || !Array.isArray(stored.options)) throw new Error('stale');
    return stored.options.flatMap((o): PendingOption[] => {
      if (typeof o.id !== 'string' || typeof o.title !== 'string' || o.title.trim() === '') return [];
      const refs = Array.isArray(o.catalogueRefs)
        ? o.catalogueRefs.flatMap((v): CatalogueCitation[] => {
            const parsed = catalogueCitationSchema.safeParse(v);
            return parsed.success ? [parsed.data] : [];
          })
        : [];
      const title = clean(o.title);
      const summary = clean(o.summary);
      return [{
        ...o,
        title,
        summary,
        toWeigh: clean(o.toWeigh),
        suggestedTitle: clean(o.suggestedTitle) || title,
        suggestedSummary: clean(o.suggestedSummary) || summary,
        draftedAt: typeof o.draftedAt === 'string' ? o.draftedAt : new Date(now).toISOString(),
        catalogueRefs: refs,
        catalogueProducts: parseCatalogueProducts(o.catalogueProducts),
      }];
    });
  } catch {
    storage.removeItem(key);
    return [];
  }
}

export function removePending(storage: StorageLike, key: string, id: UUID, now: number): void {
  savePending(storage, key, loadPending(storage, key, now).filter((o) => o.id !== id), now);
}

/** The text stored as the option's description: the plain summary, then what to weigh on its own line. */
export function optionDescription(option: Pick<PendingOption, 'summary' | 'toWeigh'>): string {
  const summary = citationsToNames(option.summary.trim(), {});
  const toWeigh = citationsToNames(option.toWeigh.trim(), {});
  return toWeigh === '' ? summary : `${summary}\n\nTo weigh: ${toWeigh}`;
}

/** The clock, read in one place so callers in render code do not each call it. */
export function clockNow(): number {
  return Date.now();
}
