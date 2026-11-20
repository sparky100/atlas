/**
 * The Designer's free trial (Simon, 2026-11-20): an organisation with agents
 * switched on but no AI key of its own may run the Designer a few times on the
 * platform key. One place for the numbers and the counting, so the page, the
 * Designer function and the tests agree. No logic beyond counting, no I/O.
 *
 * `supabase/functions/llm-proxy` (Deno, cannot import this) enforces the same
 * rule itself and is the real gate; keep its constants and counting in sync
 * by hand. The tokens and runs only: Atlas holds no price list.
 */

/** Designer runs an organisation may make on the platform key, in total. */
export const TRIAL_RUNS = 5;
/** Backstop: a new run is refused once the trial has used this many tokens (in plus out), whatever the run count. */
export const TRIAL_TOKENS = 300_000;

export interface TrialRow {
  key_source: string;
  status: string;
  run_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

export interface TrialUse {
  runsUsed: number;
  tokensUsed: number;
  runsLeft: number;
}

/** Pure: what an organisation's trial rows add up to. A run counts once it has a successful call; a failed call costs no run. */
export function summariseTrial(rows: readonly TrialRow[]): TrialUse {
  const runs = new Set<string>();
  let tokens = 0;
  for (const row of rows) {
    if (row.key_source !== 'trial' || row.status !== 'ok') continue;
    if (row.run_id !== null) runs.add(row.run_id);
    tokens += (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
  }
  const runsUsed = runs.size;
  const runsLeft = tokens >= TRIAL_TOKENS ? 0 : Math.max(0, TRIAL_RUNS - runsUsed);
  return { runsUsed, tokensUsed: tokens, runsLeft };
}

/** Pure: may this call go ahead? A call in a run already started is always allowed, so a run is never cut off half way. */
export function trialAllows(use: TrialUse, runAlreadyStarted: boolean): boolean {
  return runAlreadyStarted || use.runsLeft > 0;
}
