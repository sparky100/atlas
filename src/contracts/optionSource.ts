import type { CatalogueClaim, CatalogueStanding } from './productCatalogue';

interface OptionSourceCommon {
  /** Stable within a decision: the option plus the source's own identity. */
  id: string;
  /** The candidate option the source belongs to (20261125130000_option_keyed_research.sql). */
  optionId: string;
  /** The option's change, when it had one at the time the source was saved. Never the key. */
  branchId: string | null;
  citedBy: string;
  citedAt: string;
}

/**
 * One piece of evidence behind a decision's option, in the shape the option
 * page and the pack both read. A catalogue source is a saved citation: it
 * says what the catalogue said when the option was added, not what the
 * catalogue says today. `standing` is the one live part — it tells a reader
 * whether that saved citation is still current, has been replaced, or has
 * been withdrawn.
 */
export interface OptionCatalogueSource extends OptionSourceCommon {
  kind: 'catalogue';
  sector: string;
  version: number;
  entryCode: string;
  product: string;
  vendor: string;
  summary: string;
  licence: string;
  standing: CatalogueStanding;
  claims: readonly CatalogueClaim[];
}

/**
 * A web page saved with an option. It is not a catalogue claim: there is no
 * named reviewer and no editorial check, so it is always shown as unreviewed.
 * The URL is the saved identity; the title, publisher and excerpt are what the
 * page said when it was saved.
 */
export interface OptionWebSource extends OptionSourceCommon {
  kind: 'web';
  url: string;
  title: string;
  publisher: string | null;
  excerpt: string | null;
  retrievedAt: string;
  /** What the person checked this page supports. Null for a page saved before the guarded Researcher. */
  assertion: string | null;
  /** The person who made that check; null when no check was recorded. */
  checkedBy: string | null;
  /** When the check was made; null when no check was recorded. */
  checkedAt: string | null;
}

/** Every source kind is kept behind `kind`, so a renderer that forgets one fails to type-check. */
export type OptionSource = OptionCatalogueSource | OptionWebSource;

/** One saved web source row, before mapping to the view shape. */
export interface OptionWebSourceRow {
  decision_id: string;
  branch_id: string | null;
  option_id: string;
  url: string;
  title: string;
  publisher: string | null;
  excerpt: string | null;
  retrieved_at: string;
  cited_by: string;
  cited_at: string;
  assertion: string | null;
  checked_by: string | null;
  checked_at: string | null;
}

/** What a saved citation names, in words: "product revision 3" for a product published on its own, otherwise "catalogue v1". */
export function citationLabel(source: { sector: string; version: number }): string {
  return source.sector === 'product' ? `product revision ${String(source.version)}` : `catalogue v${String(source.version)}`;
}
