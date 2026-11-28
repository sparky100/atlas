/**
 * "Load your research": turn rows an admin pastes from a spreadsheet or an AI
 * chat into draft catalogue products. Pure rules, no I/O. One row is one claim;
 * rows with the same vendor and product become one product with several claims.
 * A row that names a platform different from its product is a component of that
 * platform. Nothing here decides what is true: every claim is saved as a draft
 * waiting for review, with its source, and the page check is shown separately.
 */
import { CATALOGUE_CLAIM_KINDS, catalogueSourceUrlSchema, containsCataloguePrice } from '../contracts/productCatalogue';
import { CATALOGUE_PRODUCT_LIMITS, type CatalogueProductContent } from '../contracts/catalogueAdmin';
import { nameMatchKey, productCode } from './catalogueFindProducts';

export const RESEARCH_MAX_ROWS = 200;
export const RESEARCH_MAX_CLAIMS_PER_PRODUCT = 8;
export const RESEARCH_COLUMNS = ['Platform', 'Vendor', 'Product or module', 'Summary', 'Source link', 'Quoted sentence', 'Kind'] as const;

type ClaimKind = (typeof CATALOGUE_CLAIM_KINDS)[number];

/** The prompt an admin can paste into any AI chat to get a table in the right shape. */
export const RESEARCH_PROMPT = [
  'I am building a product catalogue. For the platform or products I name below, list the modules or products, one claim per row, as a table with exactly these columns:',
  RESEARCH_COLUMNS.join(' | '),
  'Rules:',
  '- Platform: the platform the module belongs to; leave it empty for a product that is not part of a platform.',
  '- Product or module: the name the vendor uses today. Add the older name in brackets if it changed.',
  '- Summary: one plain sentence on what it does.',
  '- Source link: a public https page from the vendor or a reputable publisher that names the module (and the platform, if there is one).',
  '- Quoted sentence: ONE sentence copied word for word from that page that supports the summary. Never invent or paraphrase it.',
  '- Kind: functional, deployment, licensing_model, support_end or integration. Use functional if unsure.',
  '- Never include prices or costs.',
  '- Give the table only, so it can be pasted into a spreadsheet.',
  'Platform or products to research: ',
].join('\n');

export interface ResearchRow {
  line: number;
  platform: string;
  vendor: string;
  product: string;
  summary: string;
  sourceUrl: string;
  sentence: string;
  kind: ClaimKind;
}

export interface ResearchProblem { line: number; text: string }

const HEADERS: Record<string, keyof Omit<ResearchRow, 'line'>> = {
  platform: 'platform', suite: 'platform',
  vendor: 'vendor', supplier: 'vendor',
  product: 'product', module: 'product', 'product or module': 'product', 'module or product': 'product', name: 'product',
  summary: 'summary', description: 'summary', 'what it does': 'summary',
  source: 'sourceUrl', 'source link': 'sourceUrl', 'source url': 'sourceUrl', url: 'sourceUrl', link: 'sourceUrl',
  quote: 'sentence', 'quoted sentence': 'sentence', sentence: 'sentence', evidence: 'sentence',
  kind: 'kind', 'claim kind': 'kind', type: 'kind',
};

/** Split one line of a table: tab-separated (a spreadsheet paste), pipe-separated (an AI chat's table) or comma-separated with quotes. */
function cells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim());
  if (line.trim().startsWith('|') || line.split('|').length > 3) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  }
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1; } else quoted = !quoted;
    } else if (char === ',' && !quoted) { out.push(current.trim()); current = ''; } else current += char ?? '';
  }
  out.push(current.trim());
  return out;
}

const isRuleLine = (line: string) => /^\s*\|?\s*:?-{2,}/.test(line);
const strip = (value: string) => value.replace(/^\*\*|\*\*$/g, '').replace(/^["“]|["”]$/g, '').trim();

/** Read a pasted table. The first row must name the columns (any order, plain names). Problems are reported per line, never guessed around. */
export function parseResearch(text: string): { rows: ResearchRow[]; problems: ResearchProblem[] } {
  const lines = text.split(/\r?\n/).map((line, index) => ({ line, number: index + 1 })).filter(({ line }) => line.trim() !== '' && !isRuleLine(line));
  const problems: ResearchProblem[] = [];
  const header = lines[0];
  if (header === undefined) return { rows: [], problems: [{ line: 0, text: 'Nothing was pasted.' }] };
  const map = cells(header.line).map((cell) => HEADERS[strip(cell).toLowerCase()]);
  for (const needed of ['vendor', 'product', 'summary', 'sourceUrl', 'sentence'] as const) {
    if (!map.includes(needed)) problems.push({ line: header.number, text: `The first row must name the columns. "${RESEARCH_COLUMNS[['platform', 'vendor', 'product', 'summary', 'sourceUrl', 'sentence'].indexOf(needed)] ?? needed}" is missing.` });
  }
  if (problems.length > 0) return { rows: [], problems };
  const body = lines.slice(1);
  if (body.length > RESEARCH_MAX_ROWS) problems.push({ line: body[RESEARCH_MAX_ROWS]?.number ?? 0, text: `Only the first ${String(RESEARCH_MAX_ROWS)} rows are read at a time. Load the rest afterwards.` });
  const rows: ResearchRow[] = [];
  for (const { line, number } of body.slice(0, RESEARCH_MAX_ROWS)) {
    const values = cells(line);
    const row: Record<string, string> = {};
    map.forEach((field, index) => { if (field !== undefined) row[field] = strip(values[index] ?? ''); });
    const vendor = row.vendor ?? '';
    const product = row.product ?? '';
    const summary = row.summary ?? '';
    const sourceUrl = row.sourceUrl ?? '';
    const sentence = row.sentence ?? '';
    const kindText = (row.kind ?? '').toLowerCase().replace(/[\s-]+/g, '_');
    const kind: ClaimKind = (CATALOGUE_CLAIM_KINDS as readonly string[]).includes(kindText) ? kindText as ClaimKind : 'functional';
    const issues: string[] = [];
    if (vendor === '') issues.push('the vendor is empty');
    if (product === '') issues.push('the product or module is empty');
    if (summary === '') issues.push('the summary is empty');
    if (sentence === '') issues.push('there is no quoted sentence');
    if (sourceUrl === '' ) issues.push('there is no source link');
    else if (!catalogueSourceUrlSchema.safeParse(sourceUrl).success) issues.push('the source link is not a public https web address');
    if (vendor.length > CATALOGUE_PRODUCT_LIMITS.vendor || product.length > CATALOGUE_PRODUCT_LIMITS.product) issues.push('a name is longer than 120 characters');
    if (summary.length > CATALOGUE_PRODUCT_LIMITS.summary) issues.push('the summary is longer than 500 characters');
    if (sentence.length > 400) issues.push('the quoted sentence is longer than 400 characters');
    if ([summary, sentence].some(containsCataloguePrice)) issues.push('it mentions a price or cost, which the catalogue never holds');
    if (issues.length > 0) { problems.push({ line: number, text: `Line ${String(number)} (${product === '' ? 'no name' : product}): ${issues.join('; ')}.` }); continue; }
    rows.push({ line: number, platform: row.platform ?? '', vendor, product, summary, sourceUrl, sentence, kind });
  }
  return { rows, problems };
}

export interface ResearchClaim { kind: ClaimKind; sourceUrl: string; sentence: string; line: number }

export interface ResearchItem {
  key: string;
  vendor: string;
  product: string;
  summary: string;
  /** The platform this is a component of, by name, or null for a product on its own (or a platform itself). */
  platform: string | null;
  claims: ResearchClaim[];
  /** Set when the product is already in the library: it is then left as it is. */
  existingId: string | null;
  /** Set when the platform is already in the library. */
  platformId: string | null;
  note: string | null;
}

/** Group rows into products and match them, and their platforms, against the library (rule I1). */
export function groupResearch(rows: readonly ResearchRow[], library: readonly { id: string; vendor: string; product: string }[]): ResearchItem[] {
  const byKey = new Map(library.map((row) => [nameMatchKey(row.vendor, row.product), row.id]));
  const items = new Map<string, ResearchItem>();
  for (const row of rows) {
    const key = nameMatchKey(row.vendor, row.product);
    const platformName = row.platform.trim();
    const isOwnPlatform = platformName === '' || nameMatchKey(row.vendor, platformName) === key;
    let item = items.get(key);
    if (item === undefined) {
      item = {
        key, vendor: row.vendor, product: row.product, summary: row.summary,
        platform: isOwnPlatform ? null : platformName,
        claims: [], existingId: byKey.get(key) ?? null,
        platformId: isOwnPlatform ? null : byKey.get(nameMatchKey(row.vendor, platformName)) ?? null,
        note: null,
      };
      items.set(key, item);
    }
    if (item.claims.length >= RESEARCH_MAX_CLAIMS_PER_PRODUCT) { item.note = `Only the first ${String(RESEARCH_MAX_CLAIMS_PER_PRODUCT)} claims are kept.`; continue; }
    if (item.claims.some((claim) => claim.sourceUrl === row.sourceUrl && claim.sentence === row.sentence)) continue;
    item.claims.push({ kind: row.kind, sourceUrl: row.sourceUrl, sentence: row.sentence, line: row.line });
  }
  return [...items.values()];
}

/** Platforms the loaded rows name that are neither in the library nor loaded as their own row, so they will be added as drafts first. */
export function platformsToCreate(items: readonly ResearchItem[]): { vendor: string; product: string }[] {
  const own = new Set(items.map((item) => item.key));
  const out = new Map<string, { vendor: string; product: string }>();
  for (const item of items) {
    if (item.platform === null || item.platformId !== null || item.existingId !== null) continue;
    const key = nameMatchKey(item.vendor, item.platform);
    if (!own.has(key)) out.set(key, { vendor: item.vendor, product: item.platform });
  }
  return [...out.values()];
}

/**
 * The draft a research item is saved as. No capability links (that gap stays
 * visible) and no origin on the claims, so the server records them as drafted
 * by the person who loads them, waiting for review.
 */
export function researchContent(
  item: ResearchItem,
  platformId: string | null,
  taken: ReadonlySet<string>,
  today: string,
): CatalogueProductContent {
  return {
    code: productCode(item.vendor, item.product, taken),
    product: item.product,
    vendor: item.vendor,
    summary: item.summary,
    ...(platformId === null ? {} : { partOfProductId: platformId }),
    capabilities: [],
    claims: item.claims.map((claim, index) => ({
      position: index + 1, kind: claim.kind, statement: claim.sentence, sourceUrl: claim.sourceUrl, sourceDate: today,
    })),
  };
}
