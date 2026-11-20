import { describe, expect, it } from 'vitest';
import { summariseTrial, trialAllows, TRIAL_RUNS, TRIAL_TOKENS, type TrialRow } from './trialAllowance';

const row = (over: Partial<TrialRow> = {}): TrialRow => ({ key_source: 'trial', status: 'ok', run_id: 'r1', input_tokens: 100, output_tokens: 10, ...over });

describe('summariseTrial', () => {
  it('counts runs, not calls: several calls of one run are one run', () => {
    const use = summariseTrial([row(), row(), row({ run_id: 'r2' })]);
    expect(use.runsUsed).toBe(2);
    expect(use.runsLeft).toBe(TRIAL_RUNS - 2);
    expect(use.tokensUsed).toBe(330);
  });
  it('ignores own-key and platform-key rows, and failed calls', () => {
    const use = summariseTrial([row({ key_source: 'org' }), row({ key_source: 'app' }), row({ status: 'error' }), row({ status: 'rate_limited' })]);
    expect(use).toEqual({ runsUsed: 0, tokensUsed: 0, runsLeft: TRIAL_RUNS });
  });
  it('is used up after the allowed number of runs', () => {
    const rows = Array.from({ length: TRIAL_RUNS }, (_v, i) => row({ run_id: `r${String(i)}` }));
    expect(summariseTrial(rows).runsLeft).toBe(0);
  });
  it('is used up when the token backstop is reached, even with runs left', () => {
    expect(summariseTrial([row({ input_tokens: TRIAL_TOKENS, output_tokens: 0 })]).runsLeft).toBe(0);
  });
  it('treats missing token counts as zero', () => {
    expect(summariseTrial([row({ input_tokens: null, output_tokens: null })]).tokensUsed).toBe(0);
  });
});

describe('trialAllows', () => {
  it('lets a run already started finish, but not a new run once used up', () => {
    const used = { runsUsed: TRIAL_RUNS, tokensUsed: 1, runsLeft: 0 };
    expect(trialAllows(used, true)).toBe(true);
    expect(trialAllows(used, false)).toBe(false);
    expect(trialAllows({ runsUsed: 0, tokensUsed: 0, runsLeft: TRIAL_RUNS }, false)).toBe(true);
  });
});
