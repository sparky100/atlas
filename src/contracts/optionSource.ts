import type { CatalogueClaim, CatalogueStanding } from './productCatalogue';

interface OptionSourceCommon {
  /** Stable within a decision: the branch plus the source's own identity. */
  id: string;
  branchId: string;
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
}

/** Every source kind is kept behind `kind`, so a renderer that forgets one fails to type-check. */
export type OptionSource = OptionCatalogueSource | OptionWebSource;

/** One saved web source row, before mapping to the view shape. */
export interface OptionWebSourceRow {
  decision_id: string;
  branch_id: string;
  url: string;
  title: string;
  publisher: string | null;
  excerpt: string | null;
  retrieved_at: string;
  cited_by: string;
  cited_at: string;
}
