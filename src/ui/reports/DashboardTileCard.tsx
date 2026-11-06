/**
 * ADR-027 (F14 step 6b): one dashboard tile. Runs its report over rows the
 * dashboard already loaded (one load per source, shared by every tile that
 * uses it) and shows it the way the tile says. The title links to the full
 * report; clicking a bar opens it too.
 */
import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { parseReportSpec, type ReportRow } from '../../contracts/reportSpec';
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
  const by = parsed.spec.groupBy === undefined ? '' : reportFieldLabel(parsed.spec.groupBy).toLowerCase();
  const open = () => {
    void navigate(reportHref);
  };

  let body;
  switch (tile.kind) {
    case 'kpi':
      body = <BigNumber label={report.name} value={result.rowCount} note={result.rowCount === 1 ? 'row' : 'rows'} />;
      break;
    case 'bar':
      body = <BarChart groups={result.groups} title={`By ${by}`} onSelect={open} />;
      break;
    case 'stackedBar':
      body = <StackedBarChart groups={result.groups} title={`By ${by}, split by ${reportFieldLabel(parsed.spec.splitBy ?? '').toLowerCase()}`} />;
      break;
    case 'donut':
      body = <DonutChart groups={result.groups} title={`By ${by}`} unit="rows" />;
      break;
    case 'table':
      body = <ResultTable result={result} />;
      break;
  }

  return (
    <div className={styles.cardBody}>
      {tile.kind !== 'kpi' && (
        <Text as="h2" size="lg">
          <Link to={reportHref}>{report.name}</Link>
        </Text>
      )}
      {body}
      {tile.kind === 'kpi' && (
        <Link className={styles.cardLink} to={reportHref}>
          Open report
        </Link>
      )}
    </div>
  );
}
