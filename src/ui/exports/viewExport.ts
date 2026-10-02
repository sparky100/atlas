/**
 * F13 step 1: the shared core of a stamped view export — a picture of a
 * view (capability map, portfolio, landscape) as PNG or PDF, carrying a
 * stamp that says which model, which state of it (main, a version or a
 * change) and when. A rendering of the model, never stored state (rule 2).
 *
 * The same split `roadmapPngExport.ts` uses: each view builds a pure
 * `ExportPlan` — plain rectangles and text at fixed positions, unit-testable
 * without a canvas — and one painter here draws any plan. Always the light
 * palette: a downloaded picture is a document, not a themed screen.
 */
import type { ChipTone } from '../components/Chip/Chip';

export const EXPORT_PALETTE = {
  bg: '#ffffff',
  text: '#14181f',
  textMuted: '#5b6472',
  border: '#d9dee5',
  surface: '#f3f5f7',
  accent: '#0b5fff',
} as const;

/** Each chip tone as a fill (pale, so dark text stays readable on it) and a solid edge. */
export const TONE_COLOURS: Readonly<Record<ChipTone, { fill: string; edge: string }>> = {
  ok: { fill: '#d6f0e7', edge: '#009e73' },
  warn: { fill: '#fbeccc', edge: '#e69f00' },
  danger: { fill: '#f7dccb', edge: '#d55e00' },
  info: { fill: '#d0e5f2', edge: '#0072b2' },
  neutral: { fill: '#eceef1', edge: '#8a93a1' },
};

export type ExportShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string; stroke?: string; radius?: number }
  | { kind: 'text'; x: number; y: number; text: string; size: number; bold?: boolean; color: string; maxWidth?: number };

export interface ExportPlan {
  width: number;
  height: number;
  shapes: ExportShape[];
}

/** What the stamp says. `refLabel` is the state shown — "main", "Version v2026-Q1", "Change: Housing CRM". */
export interface ExportStamp {
  modelName: string;
  viewLabel: string;
  refLabel: string;
  /** The export date, `YYYY-MM-DD` — passed in, so plans stay pure. */
  date: string;
}

export const EXPORT_PADDING = 24;
export const STAMP_HEIGHT = 64;
/** Wide enough that the stamp's title is never squeezed, however small the view (a one-domain map, a narrow landscape). */
export const MIN_EXPORT_WIDTH = 720;

/** The stamp band at the top of every export: view and model in bold, then the state shown and the date. */
export function stampShapes(stamp: ExportStamp, width: number): ExportShape[] {
  return [
    { kind: 'text', x: EXPORT_PADDING, y: EXPORT_PADDING + 8, text: `${stamp.viewLabel} — ${stamp.modelName}`, size: 16, bold: true, color: EXPORT_PALETTE.text, maxWidth: width - 2 * EXPORT_PADDING },
    { kind: 'text', x: EXPORT_PADDING, y: EXPORT_PADDING + 30, text: `${stamp.refLabel} · exported ${stamp.date} from Atlas`, size: 12, color: EXPORT_PALETTE.textMuted, maxWidth: width - 2 * EXPORT_PADDING },
    { kind: 'rect', x: EXPORT_PADDING, y: STAMP_HEIGHT - 4, w: width - 2 * EXPORT_PADDING, h: 1, fill: EXPORT_PALETTE.border },
  ];
}

/** `text` cut to `maxChars` with an ellipsis — the plans' own width budget, since a plan can't measure text. */
export function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text;
}

/** The filename for an export: `{model}-{view}-{date}.{ext}`, safe on every OS. */
export function exportFilename(stamp: ExportStamp, ext: 'png' | 'pdf'): string {
  const safe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'export';
  return `${safe(stamp.modelName)}-${safe(stamp.viewLabel)}-${stamp.date}.${ext}`;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Paints a plan onto an already-sized context. */
export function drawExportPlan(ctx: CanvasRenderingContext2D, plan: ExportPlan): void {
  ctx.fillStyle = EXPORT_PALETTE.bg;
  ctx.fillRect(0, 0, plan.width, plan.height);
  ctx.textBaseline = 'middle';
  for (const shape of plan.shapes) {
    if (shape.kind === 'rect') {
      roundedRect(ctx, shape.x, shape.y, shape.w, shape.h, shape.radius ?? 0);
      ctx.fillStyle = shape.fill;
      ctx.fill();
      if (shape.stroke) {
        ctx.strokeStyle = shape.stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    } else {
      ctx.font = `${shape.bold ? 'bold ' : ''}${String(shape.size)}px sans-serif`;
      ctx.fillStyle = shape.color;
      ctx.fillText(shape.text, shape.x, shape.y, shape.maxWidth);
    }
  }
}

/** Renders at 2× for a sharp picture, returned as PNG bytes. */
async function planToPngBlob(plan: ExportPlan): Promise<Blob> {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = plan.width * scale;
  canvas.height = plan.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  ctx.scale(scale, scale);
  drawExportPlan(ctx, plan);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not render the picture.'));
    }, 'image/png');
  });
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function downloadPlanAsPng(plan: ExportPlan, stamp: ExportStamp): Promise<void> {
  download(await planToPngBlob(plan), exportFilename(stamp, 'png'));
}

/** One page sized to the picture (1px = 0.75pt), the picture on it, and the stamp as the document's title. `pdf-lib` loads only when a PDF is asked for. */
export async function downloadPlanAsPdf(plan: ExportPlan, stamp: ExportStamp): Promise<void> {
  const [{ PDFDocument }, png] = await Promise.all([import('pdf-lib'), planToPngBlob(plan)]);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${stamp.viewLabel} — ${stamp.modelName} (${stamp.refLabel}, ${stamp.date})`);
  pdf.setCreator('Atlas');
  const image = await pdf.embedPng(new Uint8Array(await png.arrayBuffer()));
  const page = pdf.addPage([plan.width * 0.75, plan.height * 0.75]);
  page.drawImage(image, { x: 0, y: 0, width: plan.width * 0.75, height: plan.height * 0.75 });
  const bytes = await pdf.save();
  download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), exportFilename(stamp, 'pdf'));
}

/** The stamp's "which state" line: "Main", "Version v2026-Q1", "Change: Housing CRM", or a commit. */
export function stampRefLabel(ref: { kind: 'main' } | { kind: 'tag'; name: string } | { kind: 'branch'; branchId: string } | { kind: 'commit'; commitId: string }, branchLabel?: string): string {
  if (ref.kind === 'main') return 'Main';
  if (ref.kind === 'tag') return `Version ${ref.name}`;
  if (ref.kind === 'commit') return branchLabel ?? `Commit ${ref.commitId.slice(0, 8)}`;
  return `Change: ${branchLabel ?? ref.branchId.slice(0, 8)}`;
}

/** Today as `YYYY-MM-DD`, for the stamp — the one place an export reads the clock. */
export function exportDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
