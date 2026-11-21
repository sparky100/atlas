import type { CatalogueEntry } from '../../db/productCatalogue';

/** The latest source date across an entry's claims, or `null` when it has none. */
export function catalogueAsOf(entry: Pick<CatalogueEntry, 'claims'>): string | null {
  const dates = entry.claims.map((c) => c.sourceDate).sort();
  return dates.length > 0 ? (dates[dates.length - 1] ?? null) : null;
}

/** A source's host without `www.`, for the one-line provenance label. */
export function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** `2026-11-21` as `21 Nov 2026` (UTC, so a date never shifts by timezone). */
export function formatCatalogueDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
