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
  /** Why this one is suggested, in plain words. */
  reason: string;
}

const MAX_SYSTEMS = 5;

export function suggestOptions(capabilityNames: readonly string[], supporterNames: readonly string[]): OptionSuggestion[] {
  const subject = capabilityNames.length === 1 ? (capabilityNames[0] ?? 'this') : 'these capabilities';
  const out: OptionSuggestion[] = [];
  const unique = [...new Set(supporterNames)].sort((a, b) => a.localeCompare(b));
  for (const name of unique.slice(0, MAX_SYSTEMS)) {
    out.push({ title: `Extend ${name} to cover this`, reason: `${name} already supports ${subject}.` });
  }
  out.push({ title: 'Buy or adopt a new product', reason: 'A product we do not run yet may meet it.' });
  out.push({ title: 'Build it ourselves', reason: 'A custom build is always an option to weigh.' });
  return out;
}

/** A decision title to start from, in the person's own terms; they edit it freely. */
export function suggestDecisionTitle(systemNames: readonly string[], capabilityNames: readonly string[]): string {
  if (systemNames.length === 1) return `Keep, replace or retire ${systemNames[0] ?? 'this system'}?`;
  if (capabilityNames.length === 1) return `How should we meet ${capabilityNames[0] ?? 'this'}?`;
  return '';
}
