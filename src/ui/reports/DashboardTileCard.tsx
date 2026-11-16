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
import { runReportWithRows } from '../../engine/reportQuery';
import type { DashboardTileRow, SavedReportRow } from '../../db/types';
import { BarChart } from '../charts/BarChart';
import { BigNumber } from '../charts/BigNumber';
import { DonutChart } from '../charts/DonutChart';
import { StackedBarChart } from '../charts/StackedBarChart';
import { Text } from '../components/Text/Text';
import type { ExportTileItem } from '../exports/dashboardExport';
import { PortfolioQuadrant } from '../portfolio/PortfolioQuadrant';
import { quadrantItemsFromResult } from '../portfolio/quadrantItemsFromResult';
import { kpiBaseline, specForTile } from './dashboardTiles';
import { ResultTable } from './ReportResultView';
import { drillSearch, type ReportDrill } from './reportDrill';
import { reportFieldLabel, reportValueScale } from './reportTable';
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
  const evaluation = useMemo(() => (parsed.ok ? runReportWithRows(rows, specForTile(parsed.spec, tile.kind, tile.row_limit), { knownFields }) : null), [parsed, rows, knownFields, tile.kind, tile.row_limit]);
  const result = evaluation?.result ?? null;

  useEffect(() => {
    if (!onResult) return undefined;
    onResult(tile.id, parsed.ok && result !== null ? { title: report.name, kind: tile.kind, size: tile.size, spec: specForTile(parsed.spec, tile.kind, tile.row_limit), result } : null);
    return () => {
      onResult(tile.id, null);
    };
  }, [onResult, tile.id, tile.kind, tile.size, tile.row_limit, report.name, parsed, result]);

  if (!parsed.ok || result === null || evaluation === null) {
    return <Text as="p">“{report.name}” can't be shown: {parsed.ok ? 'it could not be run' : parsed.error}</Text>;
  }
  const spec = parsed.spec;
  const by = spec.groupBy === undefined ? '' : reportFieldLabel(spec.groupBy).toLowerCase();
  // Clicking a mark opens the report narrowed to those rows (the drill lives in the URL; nothing is saved).
  const drill = (drills: ReportDrill[]) => {
    void navigate(`${reportHref}?${drillSearch(drills)}`);
  };
  const groupScale = reportValueScale(spec.groupBy ?? '');
  const byGroup = (value: ReportValue) => {
    if (spec.groupBy !== undefined) drill([{ field: spec.groupBy, value }]);
  };

  let body;
  switch (tile.kind) {
    case 'kpi': {
      // A count of the whole scope ("Applications") is not a share of anything, so it gets no meter.
      const narrowed = spec.filters.some((f) => f.field !== 'elementType' && f.field !== 'type');
      body = <BigNumber label={report.name} value={result.rowCount} of={narrowed ? kpiBaseline(spec, rows) : undefined} />;
      break;
    }
    case 'bar':
      body = <BarChart groups={result.groups} title={`By ${by}`} onSelect={byGroup} scale={groupScale} />;
      break;
    case 'stackedBar':
      body = (
        <StackedBarChart
          groups={result.groups}
          title={`By ${by}, split by ${reportFieldLabel(spec.splitBy ?? '').toLowerCase()}`}
          groupScale={groupScale}
          splitScale={reportValueScale(spec.splitBy ?? '')}
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
      body = <DonutChart groups={result.groups} title={`By ${by}`} unit={spec.source === 'portfolio' ? 'items' : 'rows'} onSelect={byGroup} scale={groupScale} />;
      break;
    case 'quadrant':
      body = <PortfolioQuadrant compact items={quadrantItemsFromResult(result)} hrefFor={(id) => `${basePath}/e/${encodeURIComponent(id)}?ref=main`} />;
      break;
    case 'table':
      body = <ResultTable result={result} compact live={{ rows: evaluation.displayedRows, basePath }} />;
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
