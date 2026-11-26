import type { OptionApproach } from '../../contracts/optionApproach';
import { readSupporter, uncertaintyText, type EstateSupporter, type SupporterReading } from './estateUncertainty';

/**
 * Starting points for a decision's options, read from what Atlas already holds
 * (Simon, 2026-11-19). No AI. They only narrow where to start: every one is a
 * suggestion the person adds, edits or ignores, and none removes an option
 * (estate checks narrow, they never eliminate). Buying a product and building
 * it ourselves are always offered, so the estate is never the only answer.
 * "Stay as we are" is the decision's own baseline and is not repeated here.
 */
export interface OptionSuggestion {
  title: string;
  /** What kind of option this starting point is, carried into the add-option form. */
  approach: OptionApproach;
  /** Why this one is suggested, in plain words. */
  reason: string;
  /** What the model records and does not record about the system; `null` for Buy and Build, which nothing we run backs. */
  reading: SupporterReading | null;
  /** The reason plus the known and not-recorded lines, saved as the option's text when this starting point is added. */
  text: string;
}

const MAX_SYSTEMS = 5;

export function suggestOptions(capabilityNames: readonly string[], supporters: readonly EstateSupporter[], now: Date = new Date()): OptionSuggestion[] {
  const subject = capabilityNames.length === 1 ? (capabilityNames[0] ?? 'this') : 'these capabilities';
  const out: OptionSuggestion[] = [];
  const byName = new Map<string, EstateSupporter>();
  for (const s of supporters) if (!byName.has(s.name)) byName.set(s.name, s);
  const unique = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const supporter of unique.slice(0, MAX_SYSTEMS)) {
    const reason = `${supporter.name} already supports ${subject}.`;
    const reading = readSupporter(supporter, now);
    out.push({ title: `Extend ${supporter.name} to cover this`, approach: 'configure', reason, reading, text: uncertaintyText(reason, reading) });
  }
  const buy = 'A product we do not run yet may meet it.';
  const build = 'A custom build is always an option to weigh.';
  out.push({ title: 'Buy or adopt a new product', approach: 'buy', reason: buy, reading: null, text: uncertaintyText(buy, null) });
  out.push({ title: 'Build it ourselves', approach: 'build', reason: build, reading: null, text: uncertaintyText(build, null) });
  return out;
}

/** A decision title to start from, in the person's own terms; they edit it freely. */
export function suggestDecisionTitle(systemNames: readonly string[], capabilityNames: readonly string[]): string {
  if (systemNames.length === 1) return `Keep, replace or retire ${systemNames[0] ?? 'this system'}?`;
  if (capabilityNames.length === 1) return `How should we meet ${capabilityNames[0] ?? 'this'}?`;
  return '';
}
