/**
 * ADR-027 (F14 step 6b): one dashboard tile. Runs its report over rows the
 * dashboard already loaded (one load per source, shared by every tile that
 * uses it) and shows it the way the tile says. The title links to the full
 * report; clicking a bar, slice or segment opens the report narrowed to
 * those rows.
 */
import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { parseReportSpec, type ReportRow, type ReportValue } from '../../contracts/reportSpec';
import { runReport } from '../../engine/reportQuery';
import type { DashboardTileRow, SavedReportRow } from '../../db/types';
import { BarChart } from '../charts/BarChart';
import { BigNumber } from '../charts/BigNumber';
import { DonutChart } from '../charts/DonutChart';
import { StackedBarChart } from '../charts/StackedBarChart';
import { Text } from '../components/Text/Text';
import type { ExportTileItem } from '../exports/dashboardExport';
import { specForTile } from './dashboardTiles';
import { ResultTable } from './ReportResultView';
import { drillSearch, type ReportDrill } from './reportDrill';
import { reportFieldLabel } from './reportTable';
import styles from './Dashboard.module.css';

export interface DashboardTileCardProps {
  tile: DashboardTileRow;
  report: SavedReportRow;
  rows: readonly ReportRow[];
  knownFields: readonly string[];
  /** `/o/:org/m/:model` */
  basePath: string;
  /** Reports the tile's result (or `null` when it can't run) so the dashboard can export what is on screen. */
  onResult?: (tileId: string, item: ExportTileItem | null) => void;
}

export function DashboardTileCard({ tile, report, rows, knownFields, basePath, onResult }: DashboardTileCardProps) {
  const navigate = useNavigate();
  const parsed = useMemo(() => parseReportSpec(report.spec), [report.spec]);
  const reportHref = `${basePath}/reports/saved/${report.id}`;
  const result = useMemo(() => (parsed.ok ? runReport(rows, specForTile(parsed.spec, tile.kind, tile.row_limit), { knownFields }) : null), [parsed, rows, knownFields, tile.kind, tile.row_limit]);

  useEffect(() => {
    if (!onResult) return undefined;
    onResult(tile.id, parsed.ok && result !== null ? { title: report.name, kind: tile.kind, size: tile.size, spec: specForTile(parsed.spec, tile.kind, tile.row_limit), result } : null);
    return () => {
      onResult(tile.id, null);
    };
  }, [onResult, tile.id, tile.kind, tile.size, tile.row_limit, report.name, parsed, result]);

  if (!parsed.ok || result === null) {
    return <Text as="p">“{report.name}” can't be shown: {parsed.ok ? 'it could not be run' : parsed.error}</Text>;
  }
  const spec = parsed.spec;
  const by = spec.groupBy === undefined ? '' : reportFieldLabel(spec.groupBy).toLowerCase();
  const noun = spec.source === 'portfolio' ? 'portfolio items' : 'elements';
  // Clicking a mark opens the report narrowed to those rows (the drill lives in the URL; nothing is saved).
  const drill = (drills: ReportDrill[]) => {
    void navigate(`${reportHref}?${drillSearch(drills)}`);
  };
  const byGroup = (value: ReportValue) => {
    if (spec.groupBy !== undefined) drill([{ field: spec.groupBy, value }]);
  };

  let body;
  switch (tile.kind) {
    case 'kpi':
      body = <BigNumber label={report.name} value={result.rowCount} of={{ total: rows.length, noun }} />;
      break;
    case 'bar':
      body = <BarChart groups={result.groups} title={`By ${by}`} onSelect={byGroup} />;
      break;
    case 'stackedBar':
      body = (
        <StackedBarChart
          groups={result.groups}
          title={`By ${by}, split by ${reportFieldLabel(spec.splitBy ?? '').toLowerCase()}`}
          onSelect={(group, split) => {
            if (spec.groupBy === undefined) return;
            const drills: ReportDrill[] = [{ field: spec.groupBy, value: group }];
            if (split !== undefined && spec.splitBy !== undefined) drills.push({ field: spec.splitBy, value: split });
            drill(drills);
          }}
        />
      );
      break;
    case 'donut':
      body = <DonutChart groups={result.groups} title={`By ${by}`} unit={noun === 'elements' ? 'rows' : 'items'} onSelect={byGroup} />;
      break;
    case 'table':
      body = <ResultTable result={result} compact />;
      break;
  }

  return (
    <div className={styles.cardBody}>
      {tile.kind !== 'kpi' && (
        <div className={styles.cardHead}>
          <Text as="h2" size="md">
            <Link className={styles.cardTitle} to={reportHref}>
              {report.name}
            </Link>
          </Text>
          <Text size="sm" tone="muted">
            {result.rowCount} {result.rowCount === 1 ? 'row' : 'rows'}
          </Text>
        </div>
      )}
      {body}
      {tile.kind === 'kpi' && (
        <Link className={styles.cardLink} to={reportHref}>
          Open report →
        </Link>
      )}
    </div>
  );
}
