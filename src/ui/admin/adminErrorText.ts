import { ZodError } from 'zod';

type ZodIssue = ZodError['issues'][number];

const FIELD: Record<string, string> = {
  code: 'Stable code', product: 'Product', vendor: 'Vendor', summary: 'Summary',
  statement: 'Statement', sourceUrl: 'Source link', sourceDate: 'Source date', kind: 'Kind',
  howItSupports: 'How it supports it', capabilityName: 'Capability', capabilityCode: 'Capability',
};

const PART: Record<string, string> = { claims: 'Claim', capabilities: 'Capability link', generalCapabilities: 'Shared capability link' };

/** Where in the form an issue sits, in words: "Claim 3, Source link". */
function where(path: readonly PropertyKey[]): string {
  const [first, second, third] = path;
  if (typeof first === 'string' && typeof second === 'number') {
    const part = `${PART[first] ?? first} ${String(second + 1)}`;
    return typeof third === 'string' ? `${part}, ${FIELD[third] ?? third}` : part;
  }
  return typeof first === 'string' ? (FIELD[first] ?? first) : 'This form';
}

/** What to do about one issue, in plain words. An empty value and a malformed one are told apart. */
function advice(issue: ZodIssue, field: PropertyKey | undefined): string {
  if (issue.code === 'too_small') {
    if (field === 'statement') return 'write what the vendor says';
    if (field === 'sourceUrl') return 'add the web address of the page that says it';
    if (field === 'sourceDate') return 'add the date of the page';
    return 'fill this in';
  }
  if (issue.message.includes('without prices')) return 'take the price out. Atlas holds cost as a band, never a figure';
  if (issue.message.includes('HTTPS')) return 'use a public web address that starts with https:// and has no username, password or port';
  if (issue.message.includes('lowercase')) return 'use lowercase letters, numbers and hyphens, at least two characters';
  if (issue.code === 'invalid_format' && field === 'sourceDate') return 'enter the date as year-month-day, for example 2026-11-28';
  if (issue.code === 'too_big') return 'shorten it';
  return issue.message.charAt(0).toLowerCase() + issue.message.slice(1);
}

/**
 * Turn the problems a form found into sentences a person can act on. One
 * sentence per place in the form: an empty field also fails its other rules,
 * and saying so twice would only be noise.
 */
export function formIssuesText(error: ZodError): string {
  const seen = new Map<string, string>();
  for (const issue of error.issues) {
    const place = where(issue.path);
    const field = issue.path[issue.path.length - 1];
    const existing = seen.get(place);
    // An empty value is the real problem; its other rule messages follow from it.
    if (existing === undefined || issue.code === 'too_small') seen.set(place, `${place}: ${advice(issue, field)}.`);
  }
  const lines = [...seen.values()];
  return lines.length === 1 ? (lines[0] ?? '') : `Fix these before saving. ${lines.join(' ')}`;
}

/** The sentence to show for anything an admin action threw. Never raw JSON. */
export function errorText(cause: unknown): string {
  if (cause instanceof ZodError) return formIssuesText(cause);
  return cause instanceof Error ? cause.message : String(cause);
}
