/**
 * F5's own PNG export — a canvas rasterisation of exactly the same
 * geometry `RoadmapView.tsx` renders in the DOM (grouped bars, support-end
 * ticks, add/retire/replace markers, the always-shown changes list),
 * over the same filtered/moded visible set `roadmapVisibleData.ts`
 * computes. No new dependency (no `html2canvas`) — plain `CanvasRenderingContext2D`
 * drawing, the same choice `roadmapExport.ts`'s own module comment states
 * for the CSV: build the pure geometry first (`computeRoadmapPngPlan`,
 * unit-testable without a real canvas), then a thin paint step
 * (`drawRoadmapPng`) that can't itself be unit-tested but has nothing left
 * to get wrong beyond "draw this rectangle/text at this position."
 *
 * Always rendered in the light palette below, regardless of the viewer's
 * own theme — a downloaded image is a document, not a themed UI surface
 * (the same reasoning a printed page ignores `prefers-color-scheme`).
 */
import type { RoadmapMode } from './roadmapEligibility';
import type { RoadmapFilters } from './roadmapFilter';
import { type RoadmapGroup } from './roadmapLifecycleRows';
import { percentAt, percentAtIso, type RoadmapTimelineRange } from './roadmapTimelineScale';
import { changeDescription, computeRoadmapVisibleData, eventsForSystem } from './roadmapVisibleData';
import type { RoadmapBranchEvents } from '../../db/roadmapChangeEvents';

const PADDING = 24;
const NAME_COL_WIDTH = 200;
const TRACK_WIDTH = 700;
const AXIS_HEIGHT = 24;
const ROW_HEIGHT = 32;
const GROUP_HEADER_HEIGHT = 28;
const GROUP_GAP = 16;
const CHANGES_HEADER_HEIGHT = 28;
const CHANGE_LINE_HEIGHT = 20;

const PALETTE = {
  bg: '#ffffff',
  text: '#14181f',
  textMuted: '#5b6472',
  border: '#d9dee5',
  surfaceRaised: '#f3f5f7',
  statusOk: '#009e73',
  statusWarn: '#e69f00',
  statusNeutral: '#8a93a1',
} as const;

export interface RoadmapPngMarker {
  x: number;
  kind: 'add' | 'retire' | 'replaceFrom' | 'replaceTo';
}

export interface RoadmapPngRow {
  y: number;
  name: string;
  barX: number;
  barWidth: number;
  tone: 'warn' | 'neutral';
  supportEndX: number | undefined;
  markers: RoadmapPngMarker[];
}

export interface RoadmapPngGroup {
  headerY: number;
  label: string;
  rows: RoadmapPngRow[];
}

export interface RoadmapPngChangeLine {
  y: number;
  date: string;
  description: string;
}

export interface RoadmapPngPlan {
  width: number;
  height: number;
  axisY: number | null;
  axisTicks: { label: string; x: number }[];
  groups: RoadmapPngGroup[];
  changesHeaderY: number | null;
  changeLines: RoadmapPngChangeLine[];
}

const TRACK_X0 = PADDING + NAME_COL_WIDTH;

function xAt(pct: number): number {
  return TRACK_X0 + (TRACK_WIDTH * pct) / 100;
}

function axisTicks(range: RoadmapTimelineRange): { label: string; x: number }[] {
  const ticks: { label: string; x: number }[] = [];
  const start = new Date(range.start.getFullYear(), Math.floor(range.start.getMonth() / 3) * 3, 1);
  for (const cursor = new Date(start); cursor.getTime() <= range.end.getTime(); cursor.setMonth(cursor.getMonth() + 3)) {
    const quarter = Math.floor(cursor.getMonth() / 3) + 1;
    ticks.push({ label: `Q${String(quarter)} ${String(cursor.getFullYear())}`, x: xAt(percentAt(cursor, range)) });
  }
  return ticks;
}

function groupLabelOf(group: Pick<RoadmapGroup, 'label'>): string {
  return group.label;
}

/** Same event-to-marker mapping `RoadmapRow` draws in the DOM, in pixel space. */
function markersForBar(systemId: string, branchEvents: readonly RoadmapBranchEvents[], mode: RoadmapMode, range: RoadmapTimelineRange): RoadmapPngMarker[] {
  const markers: RoadmapPngMarker[] = [];
  for (const { event, branch } of eventsForSystem(systemId, branchEvents, mode)) {
    const pct = percentAtIso(branch.target_date ?? undefined, range);
    if (pct === undefined) continue;
    const x = xAt(pct);
    if (event.kind === 'add') markers.push({ x, kind: 'add' });
    else if (event.kind === 'retire') markers.push({ x, kind: 'retire' });
    else markers.push({ x, kind: event.fromSystemId === systemId ? 'replaceFrom' : 'replaceTo' });
  }
  return markers;
}

/** The pure pixel layout — everything `drawRoadmapPng` needs to paint, computed once so the sizing math is unit-testable without a canvas. */
export function computeRoadmapPngPlan(groups: readonly RoadmapGroup[], branchEvents: readonly RoadmapBranchEvents[], mode: RoadmapMode, filters: RoadmapFilters, range: RoadmapTimelineRange, now: Date): RoadmapPngPlan {
  const { filteredGroups, eligibleEvents } = computeRoadmapVisibleData(groups, branchEvents, mode, filters, now);

  let cursor = PADDING;
  const pngGroups: RoadmapPngGroup[] = [];
  let axisY: number | null = null;

  if (filteredGroups.length > 0) {
    axisY = cursor;
    cursor += AXIS_HEIGHT;

    for (const group of filteredGroups) {
      const headerY = cursor;
      cursor += GROUP_HEADER_HEIGHT;
      const rows: RoadmapPngRow[] = [];
      for (const bar of group.bars) {
        const startPct = percentAtIso(bar.introduced, range);
        const endPct = percentAtIso(bar.plannedEnd, range);
        const supportEndPct = percentAtIso(bar.supportEndsAt, range);
        const left = startPct ?? 0;
        const width = Math.max((endPct ?? 100) - left, 0.5);
        rows.push({
          y: cursor,
          name: bar.name,
          barX: xAt(left),
          barWidth: xAt(left + width) - xAt(left),
          tone: bar.lifecycleStatus === 'retiring' || bar.lifecycleStatus === 'retired' ? 'warn' : 'neutral',
          supportEndX: supportEndPct !== undefined ? xAt(supportEndPct) : undefined,
          markers: markersForBar(bar.systemId, branchEvents, mode, range),
        });
        cursor += ROW_HEIGHT;
      }
      pngGroups.push({ headerY, label: groupLabelOf(group), rows });
      cursor += GROUP_GAP;
    }
  }

  const changeRows = eligibleEvents
    .flatMap(({ branch, events }) => events.map((event) => ({ branch, event })))
    .sort((a, b) => (a.branch.target_date ?? '').localeCompare(b.branch.target_date ?? ''));

  let changesHeaderY: number | null = null;
  const changeLines: RoadmapPngChangeLine[] = [];
  if (changeRows.length > 0) {
    changesHeaderY = cursor;
    cursor += CHANGES_HEADER_HEIGHT;
    for (const { branch, event } of changeRows) {
      changeLines.push({ y: cursor, date: branch.target_date ?? '', description: changeDescription(event) });
      cursor += CHANGE_LINE_HEIGHT;
    }
  }

  return {
    width: PADDING * 2 + NAME_COL_WIDTH + TRACK_WIDTH,
    height: cursor + PADDING,
    axisY,
    axisTicks: filteredGroups.length > 0 ? axisTicks(range) : [],
    groups: pngGroups,
    changesHeaderY,
    changeLines,
  };
}

function markerColor(kind: RoadmapPngMarker['kind']): string {
  if (kind === 'add') return PALETTE.statusOk;
  if (kind === 'retire') return PALETTE.statusWarn;
  return PALETTE.text;
}

/** Paints `plan` onto an already-sized 2D context. Pure geometry only — no I/O, no download. */
export function drawRoadmapPng(ctx: CanvasRenderingContext2D, plan: RoadmapPngPlan): void {
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, plan.width, plan.height);
  ctx.textBaseline = 'middle';
  ctx.font = '12px sans-serif';

  if (plan.axisY !== null) {
    ctx.strokeStyle = PALETTE.border;
    ctx.beginPath();
    ctx.moveTo(TRACK_X0, plan.axisY + AXIS_HEIGHT);
    ctx.lineTo(TRACK_X0 + TRACK_WIDTH, plan.axisY + AXIS_HEIGHT);
    ctx.stroke();
    ctx.fillStyle = PALETTE.textMuted;
    for (const tick of plan.axisTicks) ctx.fillText(tick.label, tick.x, plan.axisY + AXIS_HEIGHT / 2);
  }

  for (const group of plan.groups) {
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(group.label, PADDING, group.headerY + GROUP_HEADER_HEIGHT / 2);
    ctx.font = '12px sans-serif';

    for (const row of group.rows) {
      const midY = row.y + ROW_HEIGHT / 2;
      ctx.fillStyle = PALETTE.text;
      ctx.fillText(row.name.length > 28 ? `${row.name.slice(0, 27)}…` : row.name, PADDING, midY);

      ctx.fillStyle = PALETTE.surfaceRaised;
      ctx.fillRect(TRACK_X0, midY - 6, TRACK_WIDTH, 12);

      ctx.fillStyle = row.tone === 'warn' ? PALETTE.statusWarn : PALETTE.statusNeutral;
      ctx.fillRect(row.barX, midY - 4, row.barWidth, 8);

      if (row.supportEndX !== undefined) {
        ctx.fillStyle = PALETTE.statusWarn;
        ctx.fillRect(row.supportEndX - 1, midY - 6, 2, 12);
      }

      for (const marker of row.markers) {
        ctx.fillStyle = markerColor(marker.kind);
        if (marker.kind === 'replaceFrom' || marker.kind === 'replaceTo') {
          ctx.font = 'bold 11px sans-serif';
          ctx.fillText(marker.kind === 'replaceFrom' ? '→' : '←', marker.x, midY - 8);
          ctx.font = '12px sans-serif';
        } else {
          ctx.beginPath();
          ctx.arc(marker.x, midY - 6, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  if (plan.changesHeaderY !== null) {
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('Changes on this roadmap', PADDING, plan.changesHeaderY + CHANGES_HEADER_HEIGHT / 2);
    ctx.font = '12px sans-serif';
    for (const line of plan.changeLines) {
      ctx.fillStyle = PALETTE.textMuted;
      ctx.fillText(line.date, PADDING, line.y + CHANGE_LINE_HEIGHT / 2);
      ctx.fillStyle = PALETTE.text;
      ctx.fillText(line.description, PADDING + 90, line.y + CHANGE_LINE_HEIGHT / 2);
    }
  }
}

/** Renders `plan` to a fresh, off-screen canvas and returns it as a `data:image/png` URL. */
export function roadmapPngPlanToDataUrl(plan: RoadmapPngPlan): string {
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  drawRoadmapPng(ctx, plan);
  return canvas.toDataURL('image/png');
}
