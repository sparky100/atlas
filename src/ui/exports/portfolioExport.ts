/**
 * F13 step 1: the Portfolio as a picture — the rows exactly as the table
 * shows them (same filters, same sort, containers toggle respected), with
 * the same labels and tones (`PortfolioTable.tsx`'s own helpers), one line
 * per row.
 */
import type { ChipTone } from '../components/Chip/Chip';
import { annualRunCostLabel } from '../elements/annualRunCost';
import { criticalityToneFor } from '../elements/criticalityTone';
import { dispositionLabel, dispositionTone } from '../elements/disposition';
import { fitForPurposeToneFor } from '../elements/fitForPurposeTone';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import { rowKindLabel } from '../portfolio/portfolioRowKind';
import { PORTFOLIO_SIGNAL_LABEL } from '../portfolio/portfolioSignalLabels';
import type { PortfolioRow } from '../portfolio/usePortfolio';
import { EXPORT_PADDING, EXPORT_PALETTE, STAMP_HEIGHT, stampShapes, TONE_COLOURS, truncate, type ExportPlan, type ExportShape, type ExportStamp } from './viewExport';

const ROW_HEIGHT = 26;
const HEADER_ROW = 28;

interface Cell {
  text: string;
  tone?: ChipTone | undefined;
  muted?: boolean;
}

interface Column {
  label: string;
  width: number;
  chars: number;
  cell: (row: PortfolioRow) => Cell;
}

const COLUMNS: Column[] = [
  { label: 'Name', width: 220, chars: 32, cell: (row) => ({ text: row.name }) },
  { label: 'Kind', width: 110, chars: 16, cell: (row) => ({ text: rowKindLabel(row) }) },
  { label: 'Run cost', width: 110, chars: 15, cell: (row) => (row.cost ? { text: annualRunCostLabel(row.cost) } : { text: 'Not entered', muted: true }) },
  { label: 'Fit', width: 90, chars: 12, cell: (row) => (row.fit ? { text: row.fit, tone: fitForPurposeToneFor(row.fit) } : { text: 'Unrated', muted: true }) },
  { label: 'Criticality', width: 90, chars: 12, cell: (row) => (row.criticality ? { text: row.criticality, tone: criticalityToneFor(row.criticality) ?? 'neutral' } : { text: '—', muted: true }) },
  { label: 'Disposition', width: 100, chars: 13, cell: (row) => (row.disposition ? { text: dispositionLabel(row.disposition), tone: dispositionTone(row.disposition) } : { text: 'Not assessed', muted: true }) },
  { label: 'Lifecycle', width: 90, chars: 12, cell: (row) => (row.lifecycleStatus ? { text: row.lifecycleStatus, tone: lifecycleToneFor(row.lifecycleStatus) ?? 'neutral' } : { text: '—', muted: true }) },
  { label: 'Capabilities', width: 90, chars: 12, cell: (row) => ({ text: String(row.capabilities.length) }) },
  { label: 'Business owner', width: 150, chars: 22, cell: (row) => (row.businessOwner ? { text: row.businessOwner.name } : { text: '—', muted: true }) },
  { label: 'Signals', width: 240, chars: 38, cell: (row) => (row.signals.length > 0 ? { text: row.signals.map((s) => PORTFOLIO_SIGNAL_LABEL[s.key]).join(', ') } : { text: '—', muted: true }) },
];

export function portfolioExportPlan(rows: readonly PortfolioRow[], stamp: Omit<ExportStamp, 'viewLabel'>): ExportPlan {
  const tableWidth = COLUMNS.reduce((sum, c) => sum + c.width, 0);
  const width = tableWidth + 2 * EXPORT_PADDING;
  const shapes: ExportShape[] = [...stampShapes({ ...stamp, viewLabel: `Portfolio (${String(rows.length)} ${rows.length === 1 ? 'row' : 'rows'})` }, width)];
  const top = STAMP_HEIGHT + 8;

  let x = EXPORT_PADDING;
  shapes.push({ kind: 'rect', x: EXPORT_PADDING, y: top, w: tableWidth, h: HEADER_ROW, fill: EXPORT_PALETTE.surface });
  for (const column of COLUMNS) {
    shapes.push({ kind: 'text', x: x + 6, y: top + HEADER_ROW / 2, text: column.label, size: 11, bold: true, color: EXPORT_PALETTE.text, maxWidth: column.width - 12 });
    x += column.width;
  }

  rows.forEach((row, i) => {
    const y = top + HEADER_ROW + i * ROW_HEIGHT;
    shapes.push({ kind: 'rect', x: EXPORT_PADDING, y: y + ROW_HEIGHT - 1, w: tableWidth, h: 1, fill: EXPORT_PALETTE.border });
    let cx = EXPORT_PADDING;
    for (const column of COLUMNS) {
      const cell = column.cell(row);
      const text = truncate(cell.text, column.chars);
      if (cell.tone) {
        shapes.push({ kind: 'rect', x: cx + 4, y: y + 4, w: Math.min(column.width - 8, text.length * 6.5 + 12), h: ROW_HEIGHT - 8, fill: TONE_COLOURS[cell.tone].fill, stroke: TONE_COLOURS[cell.tone].edge, radius: 8 });
      }
      shapes.push({ kind: 'text', x: cx + (cell.tone ? 10 : 6), y: y + ROW_HEIGHT / 2, text, size: 11, bold: column.label === 'Name', color: cell.muted ? EXPORT_PALETTE.textMuted : EXPORT_PALETTE.text, maxWidth: column.width - 12 });
      cx += column.width;
    }
  });

  if (rows.length === 0) {
    shapes.push({ kind: 'text', x: EXPORT_PADDING + 6, y: top + HEADER_ROW + ROW_HEIGHT / 2, text: 'No systems match.', size: 11, color: EXPORT_PALETTE.textMuted });
  }

  return { width, height: top + HEADER_ROW + Math.max(1, rows.length) * ROW_HEIGHT + EXPORT_PADDING, shapes };
}
