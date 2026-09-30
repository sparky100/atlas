/**
 * The Portfolio row's own "kind" — system, platform, or module — shared by
 * the table/card Kind column, the kind filter, and the kind sort
 * comparator, so all three read the identical classification. A platform
 * is a `system` element with `attributes.kind === 'platform'` (`isPlatform`);
 * its own modules are `container` elements. Nothing new: this is just a
 * three-way label over `systemKind.ts`'s existing `isPlatform`.
 */
import type { ElementsHeadRow } from '../../contracts/rows';
import { isPlatform } from '../elements/systemKind';
import type { PortfolioRow } from './usePortfolio';

export type PortfolioRowKind = 'system' | 'platform' | 'module';

export const PORTFOLIO_ROW_KIND_LABEL: Record<PortfolioRowKind, string> = {
  system: 'System',
  platform: 'Platform',
  module: 'Module',
};

export function rowKindOf(element: ElementsHeadRow): PortfolioRowKind {
  if (element.element_type === 'container') return 'module';
  return isPlatform(element) ? 'platform' : 'system';
}

export function rowKindLabel(row: PortfolioRow): string {
  return PORTFOLIO_ROW_KIND_LABEL[rowKindOf(row.element)];
}
