/**
 * Plan B1, step 2 (Simon, 2026-11-19): the connected picture behind the
 * before/after lists. For one capability and one column (Today, or After a
 * change) it lays out three bands, left to right: the capability, the systems
 * that support it, and the apps and integrations those systems connect to.
 * A pure, deterministic function of its input (CLAUDE.md rule 6); nothing is
 * stored, so there is no layout to lose (rules 2 and 3). The bands are bounded
 * by the project's own scope: only the capability's supporters and their direct
 * connections appear, never the whole landscape.
 *
 * An app that two systems both connect to is drawn once, so a shared dependency
 * reads as one box with two lines into it. Every mark (`new`, `ends`) is carried
 * as words in `caption`, never by colour alone; the canvas adds a dashed line
 * for what ends.
 */
import type { UUID } from '../../contracts/delta';
import type { BeforeAfterColumn, BeforeAfterMark } from './projectBeforeAfterModel';

export const DIAGRAM_NODE_WIDTH = 240;
export const DIAGRAM_NODE_HEIGHT = 48;
const ROW_GAP = 20;
const CAP_GAP = 90;
/** Room for a line's label to sit on the line without running into the app box: grows with the longest label. */
const MIN_APP_GAP = 270;
const MAX_APP_GAP = 480;
const LABEL_CHAR_WIDTH = 6.2;
/** Longest a label is drawn in full; anything longer is cut in the picture (the List view has it whole). */
export const DIAGRAM_LABEL_MAX_CHARS = 64;
const NAME_LINE_CHARS = 26;
/** One row of a system's box per connection, so every line leaves at its own height and its label has a row to itself. */
const LINE_PITCH = 18;

export type DiagramNodeKind = 'capability' | 'system' | 'app';

export interface DiagramNode {
  /** Unique within one diagram: kind plus element id. */
  key: string;
  elementId: UUID;
  kind: DiagramNodeKind;
  name: string;
  /** The name broken onto at most two lines, so a long name is not clipped. */
  lines: string[];
  /** `New`, `Ends` or `External` as words, or `null`. */
  caption: string | null;
  mark: BeforeAfterMark;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramEdge {
  key: string;
  fromKey: string;
  toKey: string;
  /** The edge's own verb phrase; `null` on the capability-to-system lines. */
  label: string | null;
  mark: BeforeAfterMark;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelX: number;
  labelY: number;
}

export interface ProjectDiagramLayout {
  width: number;
  height: number;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

function captionOf(mark: BeforeAfterMark, isExternal: boolean): string | null {
  const parts: string[] = [];
  if (mark === 'new') parts.push('New');
  if (mark === 'ends') parts.push('Ends');
  if (isExternal) parts.push('External');
  return parts.length === 0 ? null : parts.join(' · ');
}

/** Break a name at spaces onto at most two lines; the second is cut with an ellipsis only if it is still too long. */
export function wrapName(name: string, limit: number = NAME_LINE_CHARS): string[] {
  if (name.length <= limit) return [name];
  const words = name.split(' ');
  let first = '';
  let at = 0;
  while (at < words.length && `${first} ${words[at] ?? ''}`.trim().length <= limit) {
    first = `${first} ${words[at] ?? ''}`.trim();
    at += 1;
  }
  if (first === '') return [`${name.slice(0, limit - 1)}…`];
  const rest = words.slice(at).join(' ');
  return rest.length <= limit ? [first, rest] : [first, `${rest.slice(0, limit - 1).trimEnd()}…`];
}

function boxHeight(lines: readonly string[], caption: string | null, minimum: number): number {
  return Math.max(minimum, 14 + lines.length * 16 + (caption ? 16 : 0) + 8);
}

/** Tops of a column of boxes of the given heights, centred on a column of the given total height. */
function stackTops(heights: readonly number[], totalHeight: number): number[] {
  const used = heights.reduce((sum, h) => sum + h, 0) + Math.max(0, heights.length - 1) * ROW_GAP;
  let top = (totalHeight - used) / 2;
  return heights.map((h) => {
    const at = top;
    top += h + ROW_GAP;
    return at;
  });
}

function columnHeight(heights: readonly number[]): number {
  return heights.reduce((sum, h) => sum + h, 0) + Math.max(0, heights.length - 1) * ROW_GAP;
}

export function layoutProjectDiagram(capability: { id: UUID; name: string }, column: BeforeAfterColumn): ProjectDiagramLayout {
  // Apps, once each, in the order they are first met (systems are already sorted by name).
  const appOrder: { id: UUID; name: string; isExternal: boolean; mark: BeforeAfterMark }[] = [];
  const appIndex = new Map<UUID, number>();
  for (const system of column.systems) {
    for (const c of system.connections) {
      const at = appIndex.get(c.appId);
      if (at === undefined) {
        appIndex.set(c.appId, appOrder.length);
        appOrder.push({ id: c.appId, name: c.appName, isExternal: c.isExternal, mark: c.mark });
      } else {
        const existing = appOrder[at];
        // An app that is still connected by any line that stays or is new is not "ending".
        if (existing?.mark === 'ends' && c.mark !== 'ends') existing.mark = c.mark;
      }
    }
  }

  // Order the apps by where their lines leave the systems, so lines run
  // downhill together and cross as little as the shared apps allow.
  const rows = new Map<UUID, number[]>();
  let row = 0;
  for (const system of column.systems) {
    for (const c of system.connections) {
      rows.set(c.appId, [...(rows.get(c.appId) ?? []), row]);
      row += 1;
    }
  }
  const centre = (id: UUID) => {
    const r = rows.get(id) ?? [0];
    return r.reduce((sum, n) => sum + n, 0) / r.length;
  };
  appOrder.sort((a, b) => centre(a.id) - centre(b.id) || a.name.localeCompare(b.name));
  appOrder.forEach((a, i) => appIndex.set(a.id, i));

  const longestLabel = Math.min(DIAGRAM_LABEL_MAX_CHARS, Math.max(0, ...column.systems.flatMap((s) => s.connections.map((c) => c.label.length + (c.mark === 'same' ? 0 : 7)))));
  const appGap = Math.min(MAX_APP_GAP, Math.max(MIN_APP_GAP, Math.ceil(longestLabel * LABEL_CHAR_WIDTH) + 36));

  const linesOf = (name: string) => wrapName(name);
  const sysCaptions = column.systems.map((s) => captionOf(s.mark, false));
  const appCaptions = appOrder.map((a) => captionOf(a.mark, a.isExternal));
  const sysHeights = column.systems.map((s, i) => Math.max(boxHeight(linesOf(s.name), sysCaptions[i] ?? null, DIAGRAM_NODE_HEIGHT), s.connections.length * LINE_PITCH + 14));
  const appHeights = appOrder.map((a, i) => boxHeight(linesOf(a.name), appCaptions[i] ?? null, DIAGRAM_NODE_HEIGHT));
  const capHeight = boxHeight(linesOf(capability.name), null, DIAGRAM_NODE_HEIGHT);
  const height = Math.max(capHeight, columnHeight(sysHeights), columnHeight(appHeights));
  const capX = 0;
  const sysX = DIAGRAM_NODE_WIDTH + CAP_GAP;
  const appX = sysX + DIAGRAM_NODE_WIDTH + appGap;
  const width = appX + DIAGRAM_NODE_WIDTH;

  const nodes: DiagramNode[] = [];
  const capTop = (height - capHeight) / 2;
  const capKey = `capability:${capability.id}`;
  nodes.push({ key: capKey, elementId: capability.id, kind: 'capability', name: capability.name, lines: linesOf(capability.name), caption: null, mark: 'same', x: capX, y: capTop, width: DIAGRAM_NODE_WIDTH, height: capHeight });

  const sysTops = stackTops(sysHeights, height);
  const sysKeyOf = new Map<UUID, string>();
  column.systems.forEach((s, i) => {
    const key = `system:${s.id}`;
    sysKeyOf.set(s.id, key);
    nodes.push({ key, elementId: s.id, kind: 'system', name: s.name, lines: linesOf(s.name), caption: captionOf(s.mark, false), mark: s.mark, x: sysX, y: sysTops[i] ?? 0, width: DIAGRAM_NODE_WIDTH, height: sysHeights[i] ?? DIAGRAM_NODE_HEIGHT });
  });

  const appTops = stackTops(appHeights, height);
  const appKeyOf = new Map<UUID, string>();
  appOrder.forEach((a, i) => {
    const key = `app:${a.id}`;
    appKeyOf.set(a.id, key);
    nodes.push({ key, elementId: a.id, kind: 'app', name: a.name, lines: linesOf(a.name), caption: captionOf(a.mark, a.isExternal), mark: a.mark, x: appX, y: appTops[i] ?? 0, width: DIAGRAM_NODE_WIDTH, height: appHeights[i] ?? DIAGRAM_NODE_HEIGHT });
  });

  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const edges: DiagramEdge[] = [];
  const mid = (n: DiagramNode) => n.y + n.height / 2;

  for (const s of column.systems) {
    const to = byKey.get(sysKeyOf.get(s.id) ?? '');
    const from = byKey.get(capKey);
    if (!to || !from) continue;
    edges.push({ key: `${capKey}>${to.key}`, fromKey: capKey, toKey: to.key, label: null, mark: s.mark, x1: from.x + from.width, y1: mid(from), x2: to.x, y2: mid(to), labelX: (from.x + from.width + to.x) / 2, labelY: (mid(from) + mid(to)) / 2 });
  }

  const incoming = new Map<UUID, number>();
  for (const s of column.systems) {
    const from = byKey.get(sysKeyOf.get(s.id) ?? '');
    if (!from) continue;
    const used = s.connections.length * LINE_PITCH;
    const firstPort = from.y + (from.height - used) / 2 + LINE_PITCH / 2;
    s.connections.forEach((c, i) => {
      const to = byKey.get(appKeyOf.get(c.appId) ?? '');
      if (!to) return;
      // Lines into the same app arrive a little apart too.
      const nth = incoming.get(c.appId) ?? 0;
      incoming.set(c.appId, nth + 1);
      const y1 = firstPort + i * LINE_PITCH;
      const y2 = mid(to) + (nth - 1) * 6;
      edges.push({
        key: `${from.key}>${to.key}>${c.key}>${c.mark}`,
        fromKey: from.key,
        toKey: to.key,
        label: c.label,
        mark: c.mark,
        x1: from.x + from.width,
        y1,
        x2: to.x,
        y2,
        // The label sits on the line just after it leaves the system, on its own row.
        labelX: from.x + from.width + 12,
        labelY: y1,
      });
    });
  }

  return { width, height, nodes, edges };
}
