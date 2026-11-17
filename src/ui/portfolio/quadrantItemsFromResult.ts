import type { AnnualRunCost, Disposition, FitForPurpose } from '../../contracts/delta';
import type { ReportResult } from '../../engine/reportQuery';
import type { QUADRANT_REPORT_COLUMNS } from '../reports/dashboardTiles';
import type { QuadrantItem } from './portfolioQuadrantModel';

/** The quadrant tile's rows, read from a Portfolio report result run with `QUADRANT_REPORT_COLUMNS`; a column the result does not have reads as unrecorded. */
export function quadrantItemsFromResult(result: Pick<ReportResult, 'columns' | 'rows'>): QuadrantItem[] {
  const at = (name: (typeof QUADRANT_REPORT_COLUMNS)[number]) => result.columns.indexOf(name);
  const col = { id: at('id'), name: at('name'), fit: at('fit'), lifecycle: at('lifecycle'), exposed: at('lifecycleExposed'), cost: at('cost'), disposition: at('disposition') };
  const str = (row: readonly unknown[], i: number): string | null => {
    const v = i < 0 ? null : row[i];
    return typeof v === 'string' && v.length > 0 ? v : null;
  };
  return result.rows.map((row, n) => ({
    id: str(row, col.id) ?? `row-${String(n)}`,
    name: str(row, col.name) ?? 'Unnamed',
    fit: str(row, col.fit) as FitForPurpose | null,
    lifecycle: str(row, col.lifecycle),
    exposed: col.exposed < 0 || typeof row[col.exposed] !== 'boolean' ? null : (row[col.exposed] as boolean),
    cost: str(row, col.cost) as AnnualRunCost | null,
    disposition: str(row, col.disposition) as Disposition | null,
  }));
}
