/**
 * An option's approach (walkthrough finding 2, Simon 2026-11-20; proposal
 * PROPOSAL-option-approach, 2026-11-25): Keep, Configure, Buy or Build, or No
 * change for a decision's "Stay as we are" baseline. Stored on
 * `decision_options.approach` (20261125120000_decision_option_approach.sql),
 * so renaming an option never changes what kind of option it is. `null` means
 * a person has not decided yet. No I/O.
 */

export const OPTION_APPROACHES = ['keep', 'configure', 'buy', 'build', 'no_change'] as const;
export type OptionApproach = (typeof OPTION_APPROACHES)[number];

/** The approaches a person can choose for an option they add; No change belongs to the baseline only. */
export const CHOOSABLE_OPTION_APPROACHES = ['keep', 'configure', 'buy', 'build'] as const satisfies readonly OptionApproach[];

/** The short label on an option card, comparison column and pack heading. */
export const OPTION_APPROACH_LABELS: Readonly<Record<OptionApproach, string>> = {
  keep: 'Keep',
  configure: 'Configure',
  buy: 'Buy',
  build: 'Build',
  no_change: 'No change',
};

/** The longer wording on the add-option buttons, in plain task words. */
export const OPTION_APPROACH_CHOICES: Readonly<Record<(typeof CHOOSABLE_OPTION_APPROACHES)[number], string>> = {
  keep: 'Keep and tidy up',
  configure: 'Configure what we run',
  buy: 'Buy a product',
  build: 'Build ourselves',
};

export const NOT_DECIDED_LABEL = 'Not decided yet';

export function isOptionApproach(value: unknown): value is OptionApproach {
  return typeof value === 'string' && (OPTION_APPROACHES as readonly string[]).includes(value);
}

/**
 * The title rule the page used before the approach was stored (Keep,
 * Configure, Replace or Buy, Build as the first word). Used only once, when an
 * option is saved without an approach (an older Designer answer), and by the
 * migration's backfill. Never used to read an option that is already saved.
 */
export function approachFromTitle(title: string): OptionApproach | null {
  const t = title.trim().toLowerCase();
  if (/^keep\b/.test(t)) return 'keep';
  if (/^configure\b/.test(t)) return 'configure';
  if (/^(replace|buy)\b/.test(t)) return 'buy';
  if (/^build\b/.test(t)) return 'build';
  return null;
}
