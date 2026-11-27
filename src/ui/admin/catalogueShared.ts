import { checkRunScopeLabel, claimCheckVerdictLabel, sourceCheckLabel, type ClaimCheckRow, type SourceCheckRow } from '../../contracts/catalogueAdmin';
import type { CapabilitySetOption, CheckRunRow, CatalogueClaimReview, CatalogueProductContent, CatalogueVersionSummary, ClaimOrigin, ProductPublicationLabel, ProductPublicationState } from '../../contracts/catalogueAdmin';

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

/** The short label shown in the product list. */
export function publicationLabelText(label: ProductPublicationLabel): string {
  switch (label) {
    case 'published': return 'Published';
    case 'published_with_changes': return 'Published, unpublished changes';
    case 'withdrawn': return 'Withdrawn';
    case 'not_published': return 'Not published';
  }
}

/** The line shown on a product page: state, revision, who approved and when. */
export function publicationStatusText(state: ProductPublicationState | null): string {
  if (state === null) return 'Not published. Users do not see this product yet.';
  const approved = `approved by ${state.approvedByName ?? 'a platform admin'} on ${formatDay(state.approvedAt)}`;
  if (state.withdrawnAt !== null) {
    return `Withdrawn on ${formatDay(state.withdrawnAt)}${state.withdrawnByName === null ? '' : ` by ${state.withdrawnByName}`}: ${state.withdrawnReason ?? ''} Revision ${String(state.revision)} was ${approved}.`;
  }
  return `Published, revision ${String(state.revision)}, ${approved}.${state.unpublishedChanges ? ' It has unpublished changes: the published revision stays as it is until you publish again.' : ''}`;
}

/** Vendor and product name, trimmed and lower-cased: how a catalogue entry and a published product are matched as the same product. */
export function productMatchKey(vendor: string, product: string): string {
  return `${vendor.trim().toLowerCase()}\u0000${product.trim().toLowerCase()}`;
}

/** The entries of a sector catalogue that no currently published product matches, so withdrawing the catalogue would make them disappear for users. */
export function entriesNotYetPublished<T extends { vendor: string; product: string }>(entries: readonly T[], publishedProducts: readonly { vendor: string; product: string }[]): T[] {
  const published = new Set(publishedProducts.map((row) => productMatchKey(row.vendor, row.product)));
  return entries.filter((entry) => !published.has(productMatchKey(entry.vendor, entry.product)));
}

/** What a saved check found, in a sentence an admin can act on. */
export function sourceCheckSentence(check: SourceCheckRow): string {
  const status = check.httpStatus === null ? '' : ` (${String(check.httpStatus)})`;
  const when = `checked ${formatDay(check.checkedAt)}${check.checkedByName === null ? '' : ` by ${check.checkedByName}`}`;
  if (check.result === 'moved') return `Moved${status}: now leads to ${check.finalUrl ?? 'a different page'}, ${when}`;
  if (check.result === 'could_not_check') return `Could not check: ${check.note ?? 'no answer'}, ${when}`;
  return `${sourceCheckLabel(check.result)}${status}, ${when}`;
}


/** What the AI found for one claim, or that it has not been checked, in a sentence for the product editor. Always says the AI did it (rule A1). */
export function claimCheckSentence(check: ClaimCheckRow | undefined): string {
  if (check === undefined) return 'Claim not checked against its source yet.';
  const by = `checked by the AI${check.model === null ? '' : ` (${check.model})`} on ${formatDay(check.checkedAt)}`;
  const looked = check.dismissedAt === null ? '' : ` Looked at and kept by ${check.dismissedByName ?? 'a platform admin'} on ${formatDay(check.dismissedAt)}.`;
  const quote = check.quote === null ? '' : ` The page says: “${check.quote}”.`;
  return `Source check: ${claimCheckVerdictLabel(check.verdict)}, ${by}.${quote}${check.note === null ? '' : ` ${check.note}`}${looked}`;
}

/** One line for a run in the history: what it covered and what it found. */
export function checkRunSentence(run: CheckRunRow): string {
  const parts: string[] = [];
  if (run.scope !== 'claims') parts.push(`${String(run.linksChecked)} link${run.linksChecked === 1 ? '' : 's'}`);
  if (run.scope !== 'links') parts.push(`${String(run.claimsChecked)} claim${run.claimsChecked === 1 ? '' : 's'}`);
  const found = run.scope === 'links' ? `${String(run.flagged)} not working` : `${String(run.flagged)} need a look`;
  const tokens = run.tokens > 0 ? `, ${run.tokens.toLocaleString('en-GB')} AI tokens` : '';
  return `${checkRunScopeLabel(run.scope)}: ${parts.join(' and ')} checked, ${found}${tokens}.`;
}
