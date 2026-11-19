import { describe, expect, it } from 'vitest';
import { aiMarkLine } from './aiMarks';

describe('aiMarkLine', () => {
  it('shows nothing for a fully human decision', () => {
    expect(aiMarkLine({ ai_draft_agent: null, ai_drafted_at: null, ai_draft_edited: false })).toBeNull();
  });
  it('says who drafted it and when, and whether a person edited it', () => {
    expect(aiMarkLine({ ai_draft_agent: 'designer', ai_drafted_at: '2026-11-19T18:00:00Z', ai_draft_edited: false })).toBe('Drafted by the Designer on 19 November 2026. Not edited since.');
    expect(aiMarkLine({ ai_draft_agent: 'designer', ai_drafted_at: '2026-11-19T18:00:00Z', ai_draft_edited: true })).toBe('Drafted by the Designer on 19 November 2026, then edited by a person.');
  });
  it('still says an agent helped when the agent or date is not one it knows', () => {
    expect(aiMarkLine({ ai_draft_agent: 'steward', ai_drafted_at: null, ai_draft_edited: false })).toBe('Drafted by an AI agent. Not edited since.');
  });
});
