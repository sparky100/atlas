import type { CapabilitySetOption, CatalogueClaimReview, CatalogueProductContent, CatalogueVersionSummary, ClaimOrigin } from '../../contracts/catalogueAdmin';

/** The label this admin UI uses everywhere for a sector id. */
export function sectorLabel(sector: string): string {
  return sector.replaceAll('_', ' ');
}

/** One capability-set version, named for a product's link and the draft's pinned-set picker. */
export function setLabel(set: CapabilitySetOption): string {
  return `${sectorLabel(set.sector)} · ${set.title ?? 'Capability set'} · v${String(set.version)}${set.status === 'published' ? '' : ` (${set.status})`}`;
}

/** A general capability (codes 1 to 8) is shared by every sector set, so it is linked once as a shared capability. */
export function isGeneralCapabilityCode(code: string): boolean {
  return /^[1-8](\.|$)/.test(code);
}

/** The blank editable product a new-product page starts from. */
export function emptyProduct(): CatalogueProductContent {
  return { code: '', product: '', vendor: '', summary: '', capabilities: [], generalCapabilities: [], claims: [] };
}

/** The highest published, non-withdrawn catalogue version for one sector. */
export function currentCatalogueVersion(versions: readonly CatalogueVersionSummary[], sector: string): CatalogueVersionSummary | null {
  return versions
    .filter((version) => version.sector === sector && version.status === 'published' && version.withdrawn_at === null)
    .sort((a, b) => b.version - a.version)[0] ?? null;
}

/** A date or timestamp as a plain day, for example "26 Nov 2026". */
export function formatDay(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Who wrote a claim, in plain words. A researcher-found claim is always marked as such (rule A1). */
export function claimDraftedText(origin: ClaimOrigin, name: string | null, at: string): string {
  if (origin === 'researcher') return `Found by the Researcher on ${formatDay(at)}`;
  if (origin === 'imported') return `Loaded from a file on ${formatDay(at)}`;
  return `Entered by ${name ?? 'a platform admin'} on ${formatDay(at)}`;
}

/** The line shown under a saved claim: its state, who and when. Drafted and reviewed are different things. */
export function claimStatusText(review: Pick<CatalogueClaimReview, 'reviewState' | 'origin' | 'draftedByName' | 'draftedAt' | 'reviewedByName' | 'reviewedAt'>): string {
  const drafted = claimDraftedText(review.origin, review.draftedByName, review.draftedAt);
  if (review.reviewState === 'drafted') return `Waiting for review. ${drafted}.`;
  const reviewed = review.reviewedByName === null ? 'Reviewed' : `Reviewed by ${review.reviewedByName}`;
  return `${reviewed}${review.reviewedAt === null ? '' : ` on ${formatDay(review.reviewedAt)}`}. ${drafted}.`;
}

/** Two claims say the same thing when their kind, statement, source and source date match; the server keeps a review across a save only then. */
export function sameClaimText(a: CatalogueProductContent['claims'][number], b: CatalogueProductContent['claims'][number]): boolean {
  return a.kind === b.kind && a.statement === b.statement && a.sourceUrl === b.sourceUrl && a.sourceDate === b.sourceDate;
}
