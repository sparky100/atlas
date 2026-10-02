/**
 * F13 step 1: the landscape as a picture — the layout the canvas already
 * computed (`computeLandscapeLayout`: lanes, the enterprise boundary,
 * actors and system tiles at their positions), each system coloured by the
 * landscape's own colour-by (`landscapeTileColourFor`). Connections aren't
 * drawn in this first version, and the picture says so in its footnote.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { LandscapeColourByMode } from '../../contracts/userPreferences';
import { LANDSCAPE_COLOUR_BY_OPTIONS, landscapeTileColourFor } from '../landscape/landscapeColour';
import { NODE_HEIGHT, NODE_WIDTH, type LandscapeLayout } from '../landscape/layout';
import { EXPORT_PADDING, EXPORT_PALETTE, MIN_EXPORT_WIDTH, STAMP_HEIGHT, stampShapes, TONE_COLOURS, truncate, type ExportPlan, type ExportShape, type ExportStamp } from './viewExport';

const FOOTNOTE_HEIGHT = 28;

export interface LandscapeExportInput {
  layout: LandscapeLayout;
  systemsById: ReadonlyMap<UUID, ElementsHeadRow>;
  actorsById: ReadonlyMap<UUID, ElementsHeadRow>;
  colourBy: LandscapeColourByMode;
  stamp: Omit<ExportStamp, 'viewLabel'>;
}

export function landscapeViewLabel(mode: LandscapeColourByMode): string {
  const option = LANDSCAPE_COLOUR_BY_OPTIONS.find((o) => o.value === mode);
  return option ? `Landscape, coloured by ${option.label}` : 'Landscape';
}

export function landscapeExportPlan({ layout, systemsById, actorsById, colourBy, stamp }: LandscapeExportInput): ExportPlan {
  const width = Math.max(MIN_EXPORT_WIDTH, layout.width + 2 * EXPORT_PADDING);
  const dx = EXPORT_PADDING;
  const dy = STAMP_HEIGHT + 8;
  const shapes: ExportShape[] = [...stampShapes({ ...stamp, viewLabel: landscapeViewLabel(colourBy) }, width)];

  if (layout.boundary.bottom > layout.boundary.top) {
    shapes.push({ kind: 'rect', x: dx - 4, y: dy + layout.boundary.top - 4, w: layout.width + 8, h: layout.boundary.bottom - layout.boundary.top + 8, fill: EXPORT_PALETTE.bg, stroke: EXPORT_PALETTE.textMuted, radius: 8 });
  }

  for (const lane of layout.lanes) {
    const shaded = lane.region === 'ot' || lane.region === 'platform' || lane.region === 'external';
    shapes.push({ kind: 'rect', x: dx, y: dy + lane.y, w: layout.width, h: lane.height, fill: shaded ? EXPORT_PALETTE.surface : EXPORT_PALETTE.bg, stroke: EXPORT_PALETTE.border });
    shapes.push({ kind: 'text', x: dx + 8, y: dy + lane.y + 12, text: truncate(lane.collapsed ? `${lane.label} (collapsed)` : lane.label, 60), size: 11, bold: true, color: EXPORT_PALETTE.textMuted, maxWidth: layout.width - 16 });
  }

  for (const node of layout.actorNodes) {
    const actor = actorsById.get(node.elementId);
    if (!actor) continue;
    shapes.push({ kind: 'rect', x: dx + node.x, y: dy + node.y, w: NODE_WIDTH, h: NODE_HEIGHT, fill: EXPORT_PALETTE.bg, stroke: EXPORT_PALETTE.textMuted, radius: NODE_HEIGHT / 2 });
    shapes.push({ kind: 'text', x: dx + node.x + 12, y: dy + node.y + NODE_HEIGHT / 2, text: truncate(actor.name, 22), size: 11, color: EXPORT_PALETTE.text, maxWidth: NODE_WIDTH - 24 });
  }

  for (const node of layout.nodes) {
    const system = systemsById.get(node.elementId);
    if (!system) continue;
    const colour = landscapeTileColourFor(colourBy, system);
    const tone = colour.tone ? TONE_COLOURS[colour.tone] : { fill: EXPORT_PALETTE.bg, edge: EXPORT_PALETTE.border };
    shapes.push({ kind: 'rect', x: dx + node.x, y: dy + node.y, w: NODE_WIDTH, h: NODE_HEIGHT, fill: tone.fill, stroke: tone.edge, radius: 6 });
    shapes.push({ kind: 'text', x: dx + node.x + 8, y: dy + node.y + (colour.label ? 16 : NODE_HEIGHT / 2), text: truncate(system.name, 22), size: 11, bold: true, color: EXPORT_PALETTE.text, maxWidth: NODE_WIDTH - 16 });
    if (colour.label) shapes.push({ kind: 'text', x: dx + node.x + 8, y: dy + node.y + 33, text: truncate(colour.label, 24), size: 10, color: EXPORT_PALETTE.textMuted, maxWidth: NODE_WIDTH - 16 });
  }

  const footY = dy + layout.height + 8;
  shapes.push({ kind: 'text', x: dx, y: footY + FOOTNOTE_HEIGHT / 2, text: 'Systems by the capability they mainly support. Connections between systems are not shown in this export.', size: 10, color: EXPORT_PALETTE.textMuted, maxWidth: layout.width });

  return { width, height: footY + FOOTNOTE_HEIGHT + EXPORT_PADDING, shapes };
}
