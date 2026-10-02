/**
 * F13 step 1: the capability map as a picture — the same L1 → L2 → L3 tree
 * and the same colour-by the map itself shows (`metrics.ts`'s
 * `tileColourFor`/`aggregateTileColourFor`), laid out as columns of cards,
 * wrapping onto further rows when there are more domains than fit across.
 */
import type { RelationshipsHeadRow, ElementsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import type { CapabilityMapTree } from '../capabilityMap/layout';
import { aggregateTileColourFor, COLOUR_BY_OPTIONS, tileColourFor, type ColourByMode, type TileColour } from '../capabilityMap/metrics';
import { EXPORT_PADDING, EXPORT_PALETTE, MIN_EXPORT_WIDTH, STAMP_HEIGHT, stampShapes, TONE_COLOURS, truncate, type ExportPlan, type ExportShape, type ExportStamp } from './viewExport';

const COLUMN_WIDTH = 230;
const COLUMN_GAP = 16;
const MAX_COLUMNS = 5;
const HEADER_HEIGHT = 44;
const CARD_HEADER = 34;
const TILE_HEIGHT = 24;
const TILE_GAP = 4;
const CARD_GAP = 10;
const INNER = 8;
const ROW_GAP = 24;

export interface CapabilityMapExportInput {
  tree: CapabilityMapTree;
  mode: ColourByMode;
  supportsEdges: readonly RelationshipsHeadRow[];
  systemsById: ReadonlyMap<UUID, ElementsHeadRow>;
  stamp: Omit<ExportStamp, 'viewLabel'>;
}

/** "Capability map, coloured by Criticality" — or just "Capability map" with no colour-by. */
export function capabilityMapViewLabel(mode: ColourByMode): string {
  const option = COLOUR_BY_OPTIONS.find((o) => o.value === mode);
  return option ? `Capability map, coloured by ${option.label}` : 'Capability map';
}

function fillFor(colour: TileColour): { fill: string; edge: string } {
  return colour.tone ? TONE_COLOURS[colour.tone] : { fill: EXPORT_PALETTE.bg, edge: EXPORT_PALETTE.border };
}

function cardHeight(l3Count: number): number {
  return CARD_HEADER + (l3Count > 0 ? l3Count * (TILE_HEIGHT + TILE_GAP) + INNER - TILE_GAP : 0);
}

export function capabilityMapExportPlan({ tree, mode, supportsEdges, systemsById, stamp }: CapabilityMapExportInput): ExportPlan {
  const columns = Math.max(1, Math.min(MAX_COLUMNS, tree.l1.length));
  const width = Math.max(MIN_EXPORT_WIDTH, 2 * EXPORT_PADDING + columns * COLUMN_WIDTH + (columns - 1) * COLUMN_GAP);
  const shapes: ExportShape[] = [...stampShapes({ ...stamp, viewLabel: capabilityMapViewLabel(mode) }, width)];

  let rowTop = STAMP_HEIGHT + 12;
  for (let start = 0; start < tree.l1.length; start += MAX_COLUMNS) {
    const rowColumns = tree.l1.slice(start, start + MAX_COLUMNS);
    let rowBottom = rowTop;
    rowColumns.forEach((column, i) => {
      const x = EXPORT_PADDING + i * (COLUMN_WIDTH + COLUMN_GAP);
      const descendantIds = column.l2.flatMap((card) => [card.capability.element_id, ...card.l3.map((l3) => l3.element_id)]);
      const aggregate = aggregateTileColourFor(mode, descendantIds, supportsEdges, systemsById);
      shapes.push({ kind: 'rect', x, y: rowTop, w: COLUMN_WIDTH, h: HEADER_HEIGHT, fill: EXPORT_PALETTE.surface, stroke: aggregate.tone ? TONE_COLOURS[aggregate.tone].edge : EXPORT_PALETTE.border, radius: 6 });
      shapes.push({ kind: 'text', x: x + INNER, y: rowTop + 15, text: truncate(column.capability.name, 30), size: 13, bold: true, color: EXPORT_PALETTE.text, maxWidth: COLUMN_WIDTH - 2 * INNER });
      if (aggregate.label) shapes.push({ kind: 'text', x: x + INNER, y: rowTop + 32, text: truncate(aggregate.label, 34), size: 11, color: EXPORT_PALETTE.textMuted, maxWidth: COLUMN_WIDTH - 2 * INNER });

      let y = rowTop + HEADER_HEIGHT + CARD_GAP;
      for (const card of column.l2) {
        const h = cardHeight(card.l3.length);
        const colour = tileColourFor(mode, card.capability.element_id, supportsEdges, systemsById);
        const { fill, edge } = fillFor(colour);
        shapes.push({ kind: 'rect', x, y, w: COLUMN_WIDTH, h, fill, stroke: edge, radius: 6 });
        shapes.push({ kind: 'text', x: x + INNER, y: y + 12, text: truncate(card.capability.name, 30), size: 12, bold: true, color: EXPORT_PALETTE.text, maxWidth: COLUMN_WIDTH - 2 * INNER });
        if (colour.label) shapes.push({ kind: 'text', x: x + INNER, y: y + 26, text: truncate(colour.label, 34), size: 10, color: EXPORT_PALETTE.textMuted, maxWidth: COLUMN_WIDTH - 2 * INNER });
        let tileY = y + CARD_HEADER;
        for (const l3 of card.l3) {
          const tileColour = tileColourFor(mode, l3.element_id, supportsEdges, systemsById);
          const tile = fillFor(tileColour);
          shapes.push({ kind: 'rect', x: x + INNER, y: tileY, w: COLUMN_WIDTH - 2 * INNER, h: TILE_HEIGHT, fill: tile.fill === EXPORT_PALETTE.bg ? EXPORT_PALETTE.surface : tile.fill, stroke: tile.edge, radius: 4 });
          const text = tileColour.label ? `${truncate(l3.name, 22)} · ${truncate(tileColour.label, 12)}` : truncate(l3.name, 34);
          shapes.push({ kind: 'text', x: x + INNER + 6, y: tileY + TILE_HEIGHT / 2, text, size: 11, color: EXPORT_PALETTE.text, maxWidth: COLUMN_WIDTH - 2 * INNER - 12 });
          tileY += TILE_HEIGHT + TILE_GAP;
        }
        y += h + CARD_GAP;
      }
      rowBottom = Math.max(rowBottom, y);
    });
    rowTop = rowBottom + ROW_GAP;
  }

  if (tree.l1.length === 0) {
    shapes.push({ kind: 'text', x: EXPORT_PADDING, y: rowTop + 10, text: 'No capabilities yet.', size: 12, color: EXPORT_PALETTE.textMuted });
    rowTop += 40;
  }

  return { width, height: rowTop - ROW_GAP + EXPORT_PADDING + (tree.l1.length === 0 ? ROW_GAP : 0), shapes };
}
