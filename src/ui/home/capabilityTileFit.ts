import type { ChipTone } from '../components/Chip/Chip';
import type { CapabilityTileData } from '../../db/modelHome';
import { attributesRecord } from '../elements/attributesRecord';
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
export function isCapabilityTileWeak(tile: Pick<CapabilityTileData, 'tone' | 'weakFitCapabilities'>): boolean {
  return tile.tone !== 'ok' || tile.weakFitCapabilities.length > 0;
}

/**
 * One colour and one word per weak tile, on the app-wide scale (red: a
 * problem now; amber: needs attention soon; blue: already being handled;
 * grey: nothing recorded). Retired-and-unreplaced is red, retiring-and-
 * unreplaced amber, a planned replacement blue, "no system supports this"
 * grey, and a tile weak only through fit (tone `ok`) amber.
 */
export function tileSeverity(tile: Pick<CapabilityTileData, 'tone' | 'exposedSystems'>): { tone: ChipTone; label: string } {
  switch (tile.tone) {
    case 'neutral':
      return { tone: 'neutral', label: 'No system recorded' };
    case 'info':
      return { tone: 'info', label: 'Replacement planned' };
    case 'warn': {
      const anyRetired = tile.exposedSystems.some((system) => attributesRecord(system.attributes).lifecycleStatus === 'retired');
      return anyRetired ? { tone: 'danger', label: 'System retired' } : { tone: 'warn', label: 'System retiring' };
    }
    case 'ok':
      return { tone: 'warn', label: 'Weak fit' };
  }
}

const SEVERITY_RANK: Record<ChipTone, number> = { danger: 0, warn: 1, neutral: 2, info: 3, ok: 4 };

/** `importance` treated as least-important (ranks after `'low'`) when unset — "not assessed" is never mistaken for "assessed as low," it's simply the last thing Director home surfaces among weak tiles. */
function importanceRank(importance: CapabilityTileData['importance']): number {
  return importance === null ? Object.keys(IMPORTANCE_ORDER).length : IMPORTANCE_ORDER[importance];
}

/**
 * Director home's own weak-tile order: most severe first (red, amber,
 * grey, blue — `tileSeverity`), then importance high → low with unset
 * last, then name. Pure and unit-tested — `DirectorHome.tsx` only ever
 * calls `weakTiles.sort(...)` with this.
 */
export function compareWeakTiles(a: CapabilityTileData, b: CapabilityTileData): number {
  return SEVERITY_RANK[tileSeverity(a).tone] - SEVERITY_RANK[tileSeverity(b).tone] || importanceRank(a.importance) - importanceRank(b.importance) || a.capability.name.localeCompare(b.capability.name);
}

/**
 * Overview's fit pill text — each weak rating named separately, so an
 * `adequate` fit never reads as `poor`: "poor fit: 1 capability",
 * "adequate fit: 2 capabilities", or both joined with " · ". "· replacement
 * planned" is appended once `weakFitAllReplacementPlanned` is true (mirrors
 * the exposure tone's own "replacement planned" wording, `TONE_LABEL.info`
 * in `DirectorHome.tsx`, for the same underlying evidence). Never called
 * with both counts `0` — callers only render the pill when
 * `weakFitCapabilities` is non-empty.
 */
export function formatWeakFitPillLabel(poorFitCount: number, adequateFitCount: number, allReplacementPlanned: boolean): string {
  const part = (rating: string, count: number) => `${rating} fit: ${String(count)} ${count === 1 ? 'capability' : 'capabilities'}`;
  const base = [poorFitCount > 0 ? part('poor', poorFitCount) : null, adequateFitCount > 0 ? part('adequate', adequateFitCount) : null].filter((p): p is string => p !== null).join(' · ');
  return allReplacementPlanned ? `${base} · replacement planned` : base;
}

/** The fit pill's own tone — `info` (the same word/colour the exposure tone already uses for "replacement planned") once every weak-fit edge has one; otherwise `warn` (amber: needs attention soon), whether the weakest rating is poor or adequate — the pill's own label says which. */
export function weakFitPillTone(allReplacementPlanned: boolean): ChipTone {
  return allReplacementPlanned ? 'info' : 'warn';
}
