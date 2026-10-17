/**
 * The canvas drawing conventions for a version diff (UI-principles §6.3),
 * shared by every canvas that marks one — the landscape and the Context
 * diagram — so "added", "removed" and "changed" look the same wherever Diff
 * is on: a coloured border/line (`--diff-*` tokens), a dashed line for a
 * removed edge, and a one-character marker that carries the state without
 * colour (§8.4's "never colour-only").
 */
import type { UUID } from '../../../contracts/delta';
import type { RelationshipVersionDiff, VersionDiffState } from '../../../engine/versionDiff';

const DIFF_MARKER: Record<VersionDiffState, string> = { unchanged: '', added: '+', removed: '−', changed: '~', moved: '⤴' };
export { DIFF_MARKER };

/** The node's own diff border colour (§6.3's colour token column) — `null` for `unchanged`, which uses the same neutral border every non-diff render already draws. */
export function diffBorderColour(state: VersionDiffState, tokens: DiffTokens): string | null {
  if (state === 'added') return tokens.diffAdded;
  if (state === 'removed') return tokens.diffRemoved;
  if (state === 'changed' || state === 'moved') return tokens.diffChanged;
  return null;
}

/** The point halfway along a routed edge's own total length — item 9's routed (possibly multi-segment) paths need this instead of a plain from/to average so a diff marker sits on the line it's marking, not floating off to one side of a detour. */
export function polylineMidpoint(points: readonly { x: number; y: number }[]): { x: number; y: number } {
  const first = points[0];
  if (!first || points.length === 1) return first ?? { x: 0, y: 0 };

  const segments: { a: { x: number; y: number }; b: { x: number; y: number }; length: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    segments.push({ a, b, length: Math.hypot(b.x - a.x, b.y - a.y) });
  }

  const total = segments.reduce((sum, s) => sum + s.length, 0);
  let remaining = total / 2;
  for (const [i, segment] of segments.entries()) {
    if (remaining <= segment.length || i === segments.length - 1) {
      const t = segment.length === 0 ? 0 : remaining / segment.length;
      return { x: segment.a.x + (segment.b.x - segment.a.x) * t, y: segment.a.y + (segment.b.y - segment.a.y) * t };
    }
    remaining -= segment.length;
  }
  return first;
}

/** The resolved `--diff-*` colours a canvas reads once per draw (its own `CanvasTokens` carries them). */
export interface DiffTokens {
  diffAdded: string;
  diffRemoved: string;
  diffChanged: string;
}

/**
 * One drawn edge can stand for more than one relationship (a two-way pair is merged into one line), so its diff state is the most newsworthy of its relationships': added over removed over changed over unchanged.
 */
export function edgeDiffState(relationshipIds: readonly UUID[], byRelationshipId: ReadonlyMap<UUID, RelationshipVersionDiff>): VersionDiffState {
  const states = relationshipIds.map((id) => byRelationshipId.get(id)?.state ?? 'unchanged');
  for (const wanted of ['added', 'removed', 'changed'] as const) if (states.includes(wanted)) return wanted;
  return 'unchanged';
}
