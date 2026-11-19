import { describe, expect, it } from 'vitest';
import { startOfMonthUtc, summariseAgentUse } from './llmProxyRequests';

const row = (over: Partial<Parameters<typeof summariseAgentUse>[0][number]> = {}) => ({ key_source: 'org' as const, status: 'ok' as const, input_tokens: 100, output_tokens: 20, created_at: '2026-11-10T10:00:00Z', ...over });

describe('summariseAgentUse', () => {
  const since = startOfMonthUtc(new Date('2026-11-19T12:00:00Z'));

  it('starts the month at midnight UTC on the 1st', () => {
    expect(since.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('adds up successful calls on the organisation key this month', () => {
    expect(summariseAgentUse([row(), row({ input_tokens: 50, output_tokens: 5 })], since)).toEqual({ runs: 2, inputTokens: 150, outputTokens: 25 });
  });

  it('leaves out platform-key calls, failures, rate limits and last month', () => {
    const rows = [row({ key_source: 'app' }), row({ status: 'error' }), row({ status: 'rate_limited' }), row({ created_at: '2026-10-31T23:59:59Z' })];
    expect(summariseAgentUse(rows, since)).toEqual({ runs: 0, inputTokens: 0, outputTokens: 0 });
  });

  it('treats missing token counts as zero', () => {
    expect(summariseAgentUse([row({ input_tokens: null, output_tokens: null })], since)).toEqual({ runs: 1, inputTokens: 0, outputTokens: 0 });
  });
});
