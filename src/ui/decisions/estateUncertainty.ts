import type { FitForPurpose } from '../../contracts/delta';
import { monthsUntil, STALE_AFTER_MONTHS } from '../../contracts/thresholds';

/**
 * What Atlas records about a system that already supports the capability
 * (Simon, 2026-11-26). Read from the live model only; nothing is inferred.
 */
export interface EstateSupporter {
  name: string;
  /** Worst `fitForPurpose` across its `supports` links to the concerned capabilities; `null` = no link is rated. */
  fit: FitForPurpose | null;
  /** The author's own "what is the problem?" note on the worst-rated link, if one was written. */
  fitNote: string | null;
  /** The system's recorded end of support, or `null` if none is recorded. */
  plannedEnd: Date | null;
}

export interface SupporterReading {
  known: string[];
  notRecorded: string[];
  /** A warning, never a block: fit is poor or unrated, or support ends soon. */
  check: boolean;
}

/** Said on every system-based starting point: capacity and data fit are not in the model. */
export const CANNOT_SEE_LINE = 'Atlas cannot see capacity or data fit. A person should confirm before choosing this.';

const FIT_WORDS: Record<FitForPurpose, string> = { poor: 'Poor', adequate: 'Adequate', good: 'Good', excellent: 'Excellent' };

function monthYear(date: Date): string {
  return date.toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function readSupporter(supporter: EstateSupporter, now: Date): SupporterReading {
  const known: string[] = [];
  const notRecorded: string[] = [];
  let check = false;
  if (supporter.fit === null) {
    notRecorded.push('how well it fits is not rated');
    check = true;
  } else {
    const note = supporter.fitNote !== null && supporter.fitNote.trim() !== '' ? `: ${supporter.fitNote.trim()}` : '';
    known.push(`fit rated ${FIT_WORDS[supporter.fit]}${note}`);
    if (supporter.fit === 'poor') check = true;
  }
  if (supporter.plannedEnd === null) {
    notRecorded.push('no end of support is recorded');
  } else {
    const soon = monthsUntil(supporter.plannedEnd, now) <= STALE_AFTER_MONTHS;
    known.push(`support ${supporter.plannedEnd.getTime() <= now.getTime() ? 'ended' : 'ends'} ${monthYear(supporter.plannedEnd)}`);
    if (soon) check = true;
  }
  return { known, notRecorded, check };
}

/** Plain text saved with the option when a starting point is added, so the Challenger and the pack see the same uncertainty. */
export function uncertaintyText(reason: string, reading: SupporterReading | null): string {
  if (reading === null) return `${reason} Nothing we run is checked for this option; it is a judgement.`;
  const parts = [reason];
  if (reading.known.length > 0) parts.push(`Recorded: ${reading.known.join('; ')}.`);
  if (reading.notRecorded.length > 0) parts.push(`Not recorded: ${reading.notRecorded.join('; ')}.`);
  parts.push(CANNOT_SEE_LINE);
  return parts.join(' ');
}
