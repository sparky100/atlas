import type { ChipTone } from '../components/Chip/Chip';
import type { CapabilityTileData } from '../../db/modelHome';
import { IMPORTANCE_ORDER } from './capabilityImportance';

/**
 * F6.1 ("make capability fit-for-purpose visible to directors"): a tile
 * is weak — emphasised, moved out of the healthy row — when its exposure
 * tone says so *or* when it has a poor-fit capability, as a display rule
 * only. Fit itself never becomes part of `tone` (ADR-023's own "kept
 * separate so P-34 is exact" — folding a second signal into tone would
 * make it a blended scale with no single oracle); this function is the
 * one place the two signals combine for *placement* purposes, so
 * `DirectorHome.tsx` never has to re-derive the rule inline.
 */
export function isCapabilityTileWeak(tile: Pick<CapabilityTileData, 'tone' | 'poorFitCapabilities'>): boolean {
  return tile.tone !== 'ok' || tile.poorFitCapabilities.length > 0;
}

/**
 * Tone's own severity among *weak* tiles specifically (a weak tile's tone
 * can be `'ok'` — flagged only by a poor-fit capability, per
 * `isCapabilityTileWeak` above — so this ranks all four, not just the
 * three a tile-by-tone-alone view would ever show): an unresolved
 * lifecycle exposure (`warn`) is the most urgent; "nothing recorded"
 * (`neutral`, no known supporters at all) the next; a replacement already
 * planned (`info`) reads calmer, since it's already being handled; `ok`
 * (weak purely via fit, tone itself is fine) least urgent of the four.
 * This ranking is this file's own judgement call — there's no existing
 * order for the derived `tone` union to mirror the way `Importance`/
 * `Criticality`/`FitForPurpose` each have one.
 */
const WEAK_TONE_SEVERITY: Record<CapabilityTileData['tone'], number> = { warn: 0, neutral: 1, info: 2, ok: 3 };

/** `importance` treated as least-important (ranks after `'low'`) when unset — "not assessed" is never mistaken for "assessed as low," it's simply the last thing Director home surfaces among weak tiles. */
function importanceRank(importance: CapabilityTileData['importance']): number {
  return importance === null ? Object.keys(IMPORTANCE_ORDER).length : IMPORTANCE_ORDER[importance];
}

/**
 * Director home's own weak-tile order (the task's own rule): importance
 * high → low, unset last; ties broken by fit/exposure severity
 * (`WEAK_TONE_SEVERITY` above); remaining ties broken by name. Pure and
 * unit-tested — `DirectorHome.tsx` only ever calls `weakTiles.sort(...)`
 * with this, never re-derives the rule inline.
 */
export function compareWeakTiles(a: CapabilityTileData, b: CapabilityTileData): number {
  return importanceRank(a.importance) - importanceRank(b.importance) || WEAK_TONE_SEVERITY[a.tone] - WEAK_TONE_SEVERITY[b.tone] || a.capability.name.localeCompare(b.capability.name);
}

/**
 * The director door's own "poor fit" pill text — "poor fit: N
 * capabilities", with "· replacement planned" appended once
 * `poorFitAllReplacementPlanned` is true (mirrors the exposure tone's own
 * "replacement planned" wording, `TONE_LABEL.info` in `DirectorHome.tsx`,
 * for the same underlying evidence). Never called with `poorFitCount`
 * `0` — callers only render the pill when `poorFitCapabilities` is
 * non-empty.
 */
export function formatPoorFitPillLabel(poorFitCount: number, allReplacementPlanned: boolean): string {
  const base = `poor fit: ${String(poorFitCount)} ${poorFitCount === 1 ? 'capability' : 'capabilities'}`;
  return allReplacementPlanned ? `${base} · replacement planned` : base;
}

/** The fit pill's own tone — `info` (the same word/colour the exposure tone already uses for "replacement planned") once every poor-fit edge has one, `danger` otherwise. Deliberately its own function, not reused from `fitForPurposeTone.ts`'s `FIT_FOR_PURPOSE_TONE.poor` verbatim, since "replacement planned" is a genuinely calmer state than a still-unaddressed poor rating. */
export function poorFitPillTone(allReplacementPlanned: boolean): ChipTone {
  return allReplacementPlanned ? 'info' : 'danger';
}
