import type { CatalogueClaim, CatalogueStanding } from './productCatalogue';

/**
 * One piece of evidence behind a decision's option, in the shape the option
 * page and the pack both read. A catalogue source is a saved citation: it
 * says what the catalogue said when the option was added, not what the
 * catalogue says today. `standing` is the one live part — it tells a reader
 * whether that saved citation is still current, has been replaced, or has
 * been withdrawn.
 *
 * A second kind (web search, D4) joins this union later. Keeping the
 * catalogue shape behind `kind` means a renderer that forgets the new kind
 * fails to type-check rather than silently mislabelling a source.
 */
export interface OptionCatalogueSource {
  kind: 'catalogue';
  /** Stable per saved citation: branch, catalogue sector/version and entry. */
  id: string;
  branchId: string;
  sector: string;
  version: number;
  entryCode: string;
  product: string;
  vendor: string;
  summary: string;
  licence: string;
  standing: CatalogueStanding;
  citedBy: string;
  citedAt: string;
  claims: readonly CatalogueClaim[];
}

export type OptionSource = OptionCatalogueSource;
