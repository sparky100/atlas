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

export const DIAGRAM_NODE_WIDTH = 210;
export const DIAGRAM_NODE_HEIGHT = 48;
const ROW_GAP = 20;
const CAP_GAP = 90;
/** Wide enough that a line's label sits on the line without running into the app box. */
const APP_GAP = 270;
/** One row of a system's box per connection, so every line leaves at its own height and its label has a row to itself. */
const LINE_PITCH = 18;

export type DiagramNodeKind = 'capability' | 'system' | 'app';

export interface DiagramNode {
  /** Unique within one diagram: kind plus element id. */
  key: string;
  elementId: UUID;
  kind: DiagramNodeKind;
  name: string;
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

  const sysHeights = column.systems.map((s) => Math.max(DIAGRAM_NODE_HEIGHT, s.connections.length * LINE_PITCH + 14));
  const appHeights = appOrder.map(() => DIAGRAM_NODE_HEIGHT);
  const height = Math.max(DIAGRAM_NODE_HEIGHT, columnHeight(sysHeights), columnHeight(appHeights));
  const capX = 0;
  const sysX = DIAGRAM_NODE_WIDTH + CAP_GAP;
  const appX = sysX + DIAGRAM_NODE_WIDTH + APP_GAP;
  const width = appX + DIAGRAM_NODE_WIDTH;

  const nodes: DiagramNode[] = [];
  const capTop = (height - DIAGRAM_NODE_HEIGHT) / 2;
  const capKey = `capability:${capability.id}`;
  nodes.push({ key: capKey, elementId: capability.id, kind: 'capability', name: capability.name, caption: null, mark: 'same', x: capX, y: capTop, width: DIAGRAM_NODE_WIDTH, height: DIAGRAM_NODE_HEIGHT });

  const sysTops = stackTops(sysHeights, height);
  const sysKeyOf = new Map<UUID, string>();
  column.systems.forEach((s, i) => {
    const key = `system:${s.id}`;
    sysKeyOf.set(s.id, key);
    nodes.push({ key, elementId: s.id, kind: 'system', name: s.name, caption: captionOf(s.mark, false), mark: s.mark, x: sysX, y: sysTops[i] ?? 0, width: DIAGRAM_NODE_WIDTH, height: sysHeights[i] ?? DIAGRAM_NODE_HEIGHT });
  });

  const appTops = stackTops(appHeights, height);
  const appKeyOf = new Map<UUID, string>();
  appOrder.forEach((a, i) => {
    const key = `app:${a.id}`;
    appKeyOf.set(a.id, key);
    nodes.push({ key, elementId: a.id, kind: 'app', name: a.name, caption: captionOf(a.mark, a.isExternal), mark: a.mark, x: appX, y: appTops[i] ?? 0, width: DIAGRAM_NODE_WIDTH, height: DIAGRAM_NODE_HEIGHT });
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
