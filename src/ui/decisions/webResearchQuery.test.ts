import { describe, expect, it } from 'vitest';
import { researchQueryProblem, WEB_RESEARCH_QUERY_MAX } from './webResearchQuery';

describe('researchQueryProblem', () => {
  it('accepts a plain one-line query and trims only the edges', () => {
    expect(researchQueryProblem('  Oracle utilities customer service  ')).toBeNull();
  });

  it('refuses empty, overlong and multi-line text', () => {
    expect(researchQueryProblem('   ')).toContain('at least');
    expect(researchQueryProblem('x'.repeat(WEB_RESEARCH_QUERY_MAX + 1))).toContain('fewer');
    expect(researchQueryProblem('one\ntwo')).toBe('Keep the query to one line.');
    expect(researchQueryProblem('one\ttwo')).toBe('Keep the query to one line.');
  });
});
