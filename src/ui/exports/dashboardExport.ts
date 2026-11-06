/**
 * ADR-027 (F14 step 6c): a dashboard, or one report, as a stamped picture
 * (PNG or PDF) through the shared export painter (`viewExport.ts`). Pure: it
 * turns already-computed results into plain rectangles, text and ring
 * segments at fixed positions, so it is unit-testable without a canvas and
 * the picture says exactly what the screen said. Always the light palette: a
 * downloaded picture is a document, not a themed screen, so the chart colours
 * here are the light values of `chartTokens.css` (a test keeps them in step).
 *
 * The layout mirrors the dashboard grid: three columns, a tile spanning one,
 * two or all three, flowing left to right and wrapping.
 */
import type { ReportSpec } from '../../contracts/reportSpec';
import type { ReportResult } from '../../engine/reportQuery';
import type { DashboardTileKind, DashboardTileSize } from '../../db/types';
import { chartBars, chartCategories, chartStacked, type ChartCategory } from '../charts/chartData';
import { reportCellText, reportFieldLabel } from '../reports/reportTable';
import { EXPORT_PADDING, EXPORT_PALETTE, STAMP_HEIGHT, stampShapes, truncate, type ExportPlan, type ExportShape, type ExportStamp } from './viewExport';

/** Light-mode values of `--chart-1` to `--chart-8`, `--chart-other`, `--chart-unset`. */
export const EXPORT_CHART_COLOURS = {
  slots: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  other: '#8a93a1',
  unset: '#b8c0cc',
} as const;

export function exportColour(category: Pick<ChartCategory, 'kind' | 'slot'>): string {
  if (category.kind === 'slot' && category.slot !== null) return EXPORT_CHART_COLOURS.slots[category.slot - 1] ?? EXPORT_CHART_COLOURS.other;
  return category.kind === 'other' ? EXPORT_CHART_COLOURS.other : EXPORT_CHART_COLOURS.unset;
}

export interface ExportTileItem {
  /** The report's name. */
  title: string;
  kind: DashboardTileKind;
  size: DashboardTileSize;
  /** The report as this tile runs it (its presentation follows the tile). */
  spec: ReportSpec;
  result: ReportResult;
}

export const EXPORT_WIDTH = 1100;
const COLUMNS = 3;
const GAP = 16;
const CARD_PAD = 16;
const BAR_ROW = 24;
const TABLE_ROW = 22;
const TITLE_HEIGHT = 28;
const MAX_BARS = 12;
const MAX_TABLE_ROWS = 200;

const CONTENT_WIDTH = EXPORT_WIDTH - 2 * EXPORT_PADDING;
const COLUMN_WIDTH = (CONTENT_WIDTH - (COLUMNS - 1) * GAP) / COLUMNS;

function spanOf(size: DashboardTileSize): number {
  return size === 'one' ? 1 : size === 'two' ? 2 : 3;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function text(x: number, y: number, value: string, size: number, color: string, bold = false, maxWidth?: number): ExportShape {
  return { kind: 'text', x: round(x), y: round(y), text: value, size, bold, color, ...(maxWidth === undefined ? {} : { maxWidth: round(maxWidth) }) };
}

function rect(x: number, y: number, w: number, h: number, fill: string, radius = 0, stroke?: string): ExportShape {
  return { kind: 'rect', x: round(x), y: round(y), w: round(w), h: round(h), fill, radius, ...(stroke === undefined ? {} : { stroke }) };
}

/** Legend entries laid out left to right, wrapping at `width`. Returns the shapes and the height used. */
function legendShapes(items: readonly { category: ChartCategory; note: string }[], x: number, y: number, width: number): { shapes: ExportShape[]; height: number } {
  const shapes: ExportShape[] = [];
  let cx = x;
  let cy = y;
  for (const { category, note } of items) {
    const label = `${truncate(category.label, 18)} ${note}`;
    const itemWidth = 18 + label.length * 6.2 + 14;
    if (cx > x && cx + itemWidth > x + width) {
      cx = x;
      cy += 18;
    }
    shapes.push(rect(cx, cy - 5, 10, 10, exportColour(category), 2));
    shapes.push(text(cx + 16, cy, label, 11, EXPORT_PALETTE.text));
    cx += itemWidth;
  }
  return { shapes, height: cy - y + 18 };
}

function tableColumns(result: ReportResult, innerWidth: number): { label: string; x: number; chars: number }[] {
  const n = Math.max(1, result.columns.length);
  const colWidth = innerWidth / n;
  return result.columns.map((c, i) => ({ label: result.unknownFields.includes(c) ? `${reportFieldLabel(c)} (attribute removed)` : reportFieldLabel(c), x: i * colWidth, chars: Math.max(4, Math.floor((colWidth - 8) / 6.2)) }));
}

function visibleTableRows(result: ReportResult): number {
  return Math.min(result.rows.length, MAX_TABLE_ROWS);
}

/** Height of a tile's card for its width. */
function tileHeight(item: ExportTileItem, width: number): number {
  const inner = width - 2 * CARD_PAD;
  switch (item.kind) {
    case 'kpi':
      return CARD_PAD + 16 + 46 + 18 + CARD_PAD;
    case 'bar':
      return CARD_PAD + TITLE_HEIGHT + Math.max(1, Math.min(MAX_BARS, chartBars(item.result.groups).length)) * BAR_ROW + CARD_PAD;
    case 'stackedBar': {
      const chart = chartStacked(item.result.groups);
      const legend = legendShapes(chart.legend.map((c) => ({ category: c, note: '' })), 0, 0, inner);
      return CARD_PAD + TITLE_HEIGHT + legend.height + 6 + Math.max(1, Math.min(MAX_BARS, chart.bars.length)) * BAR_ROW + CARD_PAD;
    }
    case 'donut': {
      const categories = chartCategories(item.result.groups);
      return CARD_PAD + TITLE_HEIGHT + Math.max(140, categories.length * 18 + 8) + CARD_PAD;
    }
    case 'table': {
      const rows = visibleTableRows(item.result);
      const note = item.result.truncated || item.result.rows.length > MAX_TABLE_ROWS ? 22 : 0;
      return CARD_PAD + TITLE_HEIGHT + TABLE_ROW + Math.max(1, rows) * TABLE_ROW + note + CARD_PAD;
    }
  }
}

function tileShapes(item: ExportTileItem, x: number, y: number, width: number, height: number): ExportShape[] {
  const inner = width - 2 * CARD_PAD;
  const left = x + CARD_PAD;
  const shapes: ExportShape[] = [rect(x, y, width, height, '#ffffff', 10, EXPORT_PALETTE.border)];
  const title = () => text(left, y + CARD_PAD + 8, truncate(item.title, Math.floor(inner / 7.2)), 13, EXPORT_PALETTE.text, true, inner);
  const top = y + CARD_PAD + TITLE_HEIGHT;

  switch (item.kind) {
    case 'kpi':
      shapes.push(text(left, y + CARD_PAD + 6, truncate(item.title, Math.floor(inner / 6.5)), 12, EXPORT_PALETTE.textMuted, false, inner));
      shapes.push(text(left, y + CARD_PAD + 38, String(item.result.rowCount), 32, EXPORT_PALETTE.text, true));
      shapes.push(text(left, y + CARD_PAD + 66, item.result.rowCount === 1 ? 'row' : 'rows', 12, EXPORT_PALETTE.textMuted));
      break;
    case 'bar': {
      shapes.push(title());
      const bars = chartBars(item.result.groups).slice(0, MAX_BARS);
      const labelW = Math.min(110, inner * 0.35);
      const valueW = 78;
      const trackX = left + labelW + 8;
      const trackW = Math.max(20, inner - labelW - valueW - 16);
      if (bars.length === 0) shapes.push(text(left, top + 10, 'Nothing to chart.', 11, EXPORT_PALETTE.textMuted));
      bars.forEach((bar, i) => {
        const cy = top + i * BAR_ROW + BAR_ROW / 2;
        shapes.push(text(left, cy, truncate(bar.label, Math.floor(labelW / 6.2)), 11, EXPORT_PALETTE.text, false, labelW));
        shapes.push(rect(trackX, cy - 6, trackW, 12, EXPORT_PALETTE.surface, 3));
        shapes.push(rect(trackX, cy - 6, Math.max(2, trackW * bar.fraction), 12, exportColour(bar.category), 3));
        shapes.push(text(trackX + trackW + 8, cy, `${String(bar.count)}  ${String(bar.percent)}%`, 11, EXPORT_PALETTE.text, false, valueW));
      });
      break;
    }
    case 'stackedBar': {
      shapes.push(title());
      const chart = chartStacked(item.result.groups);
      const totals = chart.legend.map((c) => ({ category: c, note: String(chart.bars.reduce((sum, b) => sum + (b.segments.find((s) => s.category.key === c.key)?.count ?? 0), 0)) }));
      const legend = legendShapes(totals, left, top + 4, inner);
      shapes.push(...legend.shapes);
      const barsTop = top + legend.height + 6;
      const labelW = Math.min(110, inner * 0.35);
      const trackX = left + labelW + 8;
      const trackW = Math.max(20, inner - labelW - 56);
      chart.bars.slice(0, MAX_BARS).forEach((bar, i) => {
        const cy = barsTop + i * BAR_ROW + BAR_ROW / 2;
        shapes.push(text(left, cy, truncate(bar.label, Math.floor(labelW / 6.2)), 11, EXPORT_PALETTE.text, false, labelW));
        shapes.push(rect(trackX, cy - 6, trackW, 12, EXPORT_PALETTE.surface, 3));
        for (const seg of bar.segments) {
          // A 1px surface gap between neighbours, as on screen.
          shapes.push(rect(trackX + trackW * seg.start, cy - 6, Math.max(1, trackW * seg.width - 1), 12, exportColour(seg.category)));
        }
        shapes.push(text(trackX + trackW + 8, cy, String(bar.total), 11, EXPORT_PALETTE.text));
      });
      break;
    }
    case 'donut': {
      shapes.push(title());
      const categories = chartCategories(item.result.groups);
      const total = categories.reduce((sum, c) => sum + c.count, 0);
      const outer = 60;
      const cx = left + outer;
      const cy = top + Math.max(70, (categories.length * 18 + 8) / 2);
      if (total === 0) {
        shapes.push(text(left, top + 10, 'Nothing to chart.', 11, EXPORT_PALETTE.textMuted));
        break;
      }
      let angle = 0;
      for (const c of categories) {
        const sweep = (c.count / total) * Math.PI * 2;
        const gap = categories.length > 1 ? 0.02 : 0;
        shapes.push({ kind: 'arc', cx: round(cx), cy: round(cy), outer, inner: 38, from: round(angle + gap / 2), to: round(Math.max(angle + gap / 2 + 0.001, angle + sweep - gap / 2 - (categories.length === 1 ? 0.0001 : 0))), fill: exportColour(c) });
        angle += sweep;
      }
      shapes.push(text(cx, cy - 4, String(total), 20, EXPORT_PALETTE.text, true));
      shapes.push(text(cx, cy + 14, 'rows', 10, EXPORT_PALETTE.textMuted));
      const legendX = left + 2 * outer + 20;
      categories.forEach((c, i) => {
        const ly = top + 10 + i * 18;
        shapes.push(rect(legendX, ly - 5, 10, 10, exportColour(c), 2));
        shapes.push(text(legendX + 16, ly, `${truncate(c.label, 18)}  ${String(c.count)} · ${String(Math.round((c.count / total) * 1000) / 10)}%`, 11, EXPORT_PALETTE.text, false, inner - 2 * outer - 36));
      });
      break;
    }
    case 'table': {
      shapes.push(title());
      const cols = tableColumns(item.result, inner);
      shapes.push(rect(left, top, inner, TABLE_ROW, EXPORT_PALETTE.surface));
      for (const col of cols) shapes.push(text(left + col.x + 4, top + TABLE_ROW / 2, truncate(col.label, col.chars), 11, EXPORT_PALETTE.text, true, inner / Math.max(1, cols.length) - 8));
      const rows = item.result.rows.slice(0, MAX_TABLE_ROWS);
      rows.forEach((row, i) => {
        const ry = top + TABLE_ROW + i * TABLE_ROW;
        shapes.push(rect(left, ry + TABLE_ROW - 1, inner, 1, EXPORT_PALETTE.border));
        cols.forEach((col, j) => {
          shapes.push(text(left + col.x + 4, ry + TABLE_ROW / 2, truncate(reportCellText(row[j] ?? null), col.chars), 11, EXPORT_PALETTE.text, false, inner / Math.max(1, cols.length) - 8));
        });
      });
      if (rows.length === 0) shapes.push(text(left + 4, top + TABLE_ROW + TABLE_ROW / 2, 'No rows match.', 11, EXPORT_PALETTE.textMuted));
      const hidden = item.result.rowCount - rows.length;
      if (hidden > 0) {
        shapes.push(text(left + 4, top + TABLE_ROW + Math.max(1, rows.length) * TABLE_ROW + 12, `Showing ${String(rows.length)} of ${String(item.result.rowCount)} rows. Download the CSV or Excel file for all of them.`, 10, EXPORT_PALETTE.textMuted, false, inner));
      }
      break;
    }
  }
  return shapes;
}

/** Tiles in grid order: three columns, wrapping, each row as tall as its tallest tile. */
export function dashboardExportPlan(items: readonly ExportTileItem[], stamp: ExportStamp): ExportPlan {
  const shapes: ExportShape[] = [...stampShapes(stamp, EXPORT_WIDTH)];
  let y = STAMP_HEIGHT + 8;
  let rowItems: { item: ExportTileItem; col: number; span: number }[] = [];
  let col = 0;

  const flush = () => {
    if (rowItems.length === 0) return;
    const heights = rowItems.map(({ item, span }) => tileHeight(item, span * COLUMN_WIDTH + (span - 1) * GAP));
    const rowHeight = Math.max(...heights);
    for (const { item, col: c, span } of rowItems) {
      const width = span * COLUMN_WIDTH + (span - 1) * GAP;
      shapes.push(...tileShapes(item, EXPORT_PADDING + c * (COLUMN_WIDTH + GAP), y, width, rowHeight));
    }
    y += rowHeight + GAP;
    rowItems = [];
    col = 0;
  };

  for (const item of items) {
    const span = spanOf(item.size);
    if (col + span > COLUMNS) flush();
    rowItems.push({ item, col, span });
    col += span;
  }
  flush();

  if (items.length === 0) shapes.push(text(EXPORT_PADDING, y + 12, 'This dashboard has no tiles yet.', 12, EXPORT_PALETTE.textMuted));
  return { width: EXPORT_WIDTH, height: Math.max(y + (items.length === 0 ? 40 : 0), STAMP_HEIGHT + 60) + EXPORT_PADDING - GAP, shapes };
}

/**
 * One report as a picture: its row count, a chart if it groups, and its table
 * if it lists rows. The same tiles a dashboard uses, so a report and its
 * dashboard tile look alike.
 */
export function reportExportPlan(name: string, spec: ReportSpec, result: ReportResult, stamp: ExportStamp): ExportPlan {
  const items: ExportTileItem[] = [{ title: 'Rows that match', kind: 'kpi', size: 'one', spec, result }];
  if (spec.groupBy !== undefined && result.groups.length > 0) {
    const kind: DashboardTileKind = spec.presentation.kind === 'donut' ? 'donut' : spec.splitBy === undefined ? 'bar' : 'stackedBar';
    const by = reportFieldLabel(spec.groupBy).toLowerCase();
    items.push({ title: spec.splitBy === undefined ? `Rows by ${by}` : `Rows by ${by}, split by ${reportFieldLabel(spec.splitBy).toLowerCase()}`, kind, size: 'full', spec, result });
  }
  if (spec.presentation.kind === 'table') items.push({ title: name, kind: 'table', size: 'full', spec, result });
  return dashboardExportPlan(items, stamp);
}
