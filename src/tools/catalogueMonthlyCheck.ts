/**
 * Catalogue step 5b-2: the rules of the monthly check, kept apart from the
 * function that runs it so they can be tested. Which claims still need a check,
 * how big a batch is, how a run's counters add up, and how the shared secret is
 * compared. No I/O.
 */
import type { ClaimCheckResult } from './catalogueClaimCheck';
import type { LinkCheckResult } from './catalogueLinkCheck';

/** Claims checked per call, so one call stays well inside the function's time limit. */
export const MONTHLY_BATCH_CLAIMS = 20;
/** A saved check newer than this counts as "checked this month". */
export const MONTHLY_MAX_AGE_DAYS = 25;
/** A run still open after this long did not finish; the next call starts a new one. */
export const MONTHLY_RUN_OPEN_HOURS = 12;
export const MONTHLY_SECRET_HEADER = 'x-schedule-secret';

export interface MonthlyClaim {
  productId: string;
  product: string;
  vendor: string;
  sourceUrl: string;
  statement: string;
}

export interface SavedClaimCheck {
  productId: string;
  sourceUrl: string;
  statement: string;
  checkedAt: string;
}

export interface SavedLinkCheck {
  url: string;
  checkedAt: string;
}

export const monthlyClaimKey = (claim: { productId: string; sourceUrl: string; statement: string }): string =>
  JSON.stringify([claim.productId, claim.sourceUrl, claim.statement]);

/** The database refuses empty or over-long text, so such claims are left out of the work list rather than failing the whole save. */
export function isCheckableClaim(claim: MonthlyClaim): boolean {
  return claim.sourceUrl.length >= 1 && claim.sourceUrl.length <= 2000
    && claim.statement.trim().length >= 1 && claim.statement.trim().length <= 400
    && claim.product.length >= 1 && claim.vendor.length >= 1;
}

const isOlderThan = (iso: string, now: Date, days: number): boolean => now.getTime() - new Date(iso).getTime() >= days * 86_400_000;

/**
 * The claims with no saved check, or one older than `maxAgeDays`: never-checked first, then the oldest check first, ties in a fixed order.
 * `batch` is the next piece to do now, `remaining` how many are still outstanding after it.
 */
export function outstandingClaims(
  claims: readonly MonthlyClaim[],
  saved: readonly SavedClaimCheck[],
  now: Date,
  options: { maxAgeDays?: number; batchSize?: number } = {},
): { batch: MonthlyClaim[]; remaining: number } {
  const maxAgeDays = options.maxAgeDays ?? MONTHLY_MAX_AGE_DAYS;
  const batchSize = options.batchSize ?? MONTHLY_BATCH_CLAIMS;
  const checkedAt = new Map(saved.map((check) => [monthlyClaimKey(check), check.checkedAt]));
  const outstanding = claims.filter(isCheckableClaim).flatMap((claim) => {
    const at = checkedAt.get(monthlyClaimKey(claim));
    return at === undefined || isOlderThan(at, now, maxAgeDays) ? [{ claim, at: at ?? '' }] : [];
  });
  outstanding.sort((a, b) => a.at.localeCompare(b.at) || monthlyClaimKey(a.claim).localeCompare(monthlyClaimKey(b.claim)));
  return { batch: outstanding.slice(0, batchSize).map((entry) => entry.claim), remaining: Math.max(0, outstanding.length - batchSize) };
}

/** The distinct links of a batch whose own check is missing or older than `maxAgeDays`. */
export function linksToCheck(
  batch: readonly MonthlyClaim[],
  saved: readonly SavedLinkCheck[],
  now: Date,
  maxAgeDays: number = MONTHLY_MAX_AGE_DAYS,
): string[] {
  const checkedAt = new Map(saved.map((check) => [check.url, check.checkedAt]));
  const urls = [...new Set(batch.map((claim) => claim.sourceUrl))].sort();
  return urls.filter((url) => {
    const at = checkedAt.get(url);
    return at === undefined || isOlderThan(at, now, maxAgeDays);
  });
}

/** A claim whose link was found gone is not read; it is saved as "can't tell" with the reason, so it counts as checked and the run moves on. */
export function skippedClaimResult(claim: MonthlyClaim): ClaimCheckResult {
  return {
    productId: claim.productId, sourceUrl: claim.sourceUrl, statement: claim.statement,
    verdict: 'cant_tell', quote: null, note: 'The link is gone, so the page was not read.', model: null, inputTokens: 0, outputTokens: 0,
  };
}

export function claimsWithGoneLink(batch: readonly MonthlyClaim[], links: readonly LinkCheckResult[]): Set<string> {
  const gone = new Set(links.filter((link) => link.result === 'gone').map((link) => link.url));
  return new Set(batch.filter((claim) => gone.has(claim.sourceUrl)).map(monthlyClaimKey));
}

export interface RunCounters {
  linksChecked: number;
  claimsChecked: number;
  flagged: number;
  inputTokens: number;
  outputTokens: number;
}

/** Adds one batch to a run's counters. "Flagged" is a claim the AI found changed or could not tell. */
export function addBatch(run: RunCounters, links: readonly LinkCheckResult[], claims: readonly ClaimCheckResult[]): RunCounters {
  return {
    linksChecked: run.linksChecked + links.length,
    claimsChecked: run.claimsChecked + claims.length,
    flagged: run.flagged + claims.filter((claim) => claim.verdict !== 'supported').length,
    inputTokens: run.inputTokens + claims.reduce((sum, claim) => sum + claim.inputTokens, 0),
    outputTokens: run.outputTokens + claims.reduce((sum, claim) => sum + claim.outputTokens, 0),
  };
}

/** Compares two secrets without stopping at the first difference. */
export function secretsMatch(given: string | null, expected: string | null): boolean {
  if (given === null || expected === null || expected === '') return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

/** The name the monthly run saves its results under. */
export const monthlyActorName = (switchedByName: string | null): string =>
  `Monthly check (switched on by ${switchedByName ?? 'a platform admin'})`.slice(0, 120);
