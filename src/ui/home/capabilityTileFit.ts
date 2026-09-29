import type { ChipTone } from '../components/Chip/Chip';
import type { CapabilityTileData } from '../../db/modelHome';

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
