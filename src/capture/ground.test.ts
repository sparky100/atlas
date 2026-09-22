import { describe, expect, it } from 'vitest';
import { groundPassage } from './ground';

describe('groundPassage', () => {
  it('finds a byte-exact passage, grounding factor 1.0 (not normalised)', () => {
    const haystack = 'The CRM system is supplied by Acme Corp.';
    const result = groundPassage(haystack, 'supplied by Acme Corp');
    expect(result).toEqual({ found: true, normalised: false, start: 18, end: 39 });
    expect(haystack.slice(result.start, result.end)).toBe('supplied by Acme Corp');
  });

  it('finds a passage after collapsing whitespace runs', () => {
    const haystack = 'The CRM   system\nis supplied by Acme.';
    const result = groundPassage(haystack, 'The CRM system is supplied');
    expect(result.found).toBe(true);
    expect(result.normalised).toBe(true);
    expect(haystack.slice(result.start, result.end)).toBe('The CRM   system\nis supplied');
  });

  it('finds a passage after straightening curly quotes and dashes', () => {
    const haystack = 'The team said “we own it” — confirmed.';
    const result = groundPassage(haystack, 'The team said "we own it" - confirmed');
    expect(result.found).toBe(true);
    expect(result.normalised).toBe(true);
    expect(haystack.slice(result.start, result.end)).toBe('The team said “we own it” — confirmed');
  });

  it('finds a passage that differs only in case, reporting the original span', () => {
    const haystack = 'Implementation of a Contract Lifecycle Management (CLM) platform to manage contractor interactions.';
    const result = groundPassage(haystack, 'implementation of a contract lifecycle management (clm) platform to manage contractor interactions');
    expect(result.found).toBe(true);
    expect(result.normalised).toBe(true);
    expect(haystack.slice(result.start, result.end)).toBe('Implementation of a Contract Lifecycle Management (CLM) platform to manage contractor interactions');
  });

  it('finds a passage that drops a hyphen ("industry leading" vs "industry-leading")', () => {
    const haystack = 'We use Tractivity, an industry-leading system.';
    const result = groundPassage(haystack, 'We use Tractivity, an industry leading system');
    expect(result.found).toBe(true);
    expect(result.normalised).toBe(true);
    expect(haystack.slice(result.start, result.end)).toBe('We use Tractivity, an industry-leading system');
  });

  it('finds a passage where a line-break hyphenated word is read unhyphenated', () => {
    const haystack = 'Customer Stakeholder Pre-\nApplication Tool';
    const result = groundPassage(haystack, 'Customer Stakeholder Pre-Application Tool');
    expect(result.found).toBe(true);
    expect(result.normalised).toBe(true);
  });

  it('finds a passage threaded through jumbled multi-column text (word subsequence)', () => {
    const haystack = 'We use Tractivity, an industry leading system, which has over stakeholder change. Our engagement with our stakeholders 6,500 stakeholders registered.';
    const result = groundPassage(haystack, 'We use Tractivity, an industry leading system, which has over 6,500 stakeholders registered');
    expect(result.found).toBe(true);
    expect(result.normalised).toBe(true);
  });

  it('does not match a word subsequence when a passage word is absent', () => {
    const haystack = 'We use a different platform for stakeholder engagement.';
    const result = groundPassage(haystack, 'We use Tractivity for stakeholder engagement');
    expect(result.found).toBe(false);
  });

  it('reports not found when the passage is nowhere in the text, never a guess', () => {
    const result = groundPassage('The CRM system is supplied by Acme.', 'a completely different sentence');
    expect(result.found).toBe(false);
  });

  it('reports not found for an empty passage', () => {
    expect(groundPassage('some text', '').found).toBe(false);
  });

  it('finds the passage at its later occurrence when it recurs, byte-exact taking priority over any normalised match', () => {
    const haystack = 'CRM CRM is supplied by Acme.';
    const result = groundPassage(haystack, 'CRM is supplied by Acme');
    expect(result.found).toBe(true);
    expect(result.normalised).toBe(false);
    expect(haystack.slice(result.start, result.end)).toBe('CRM is supplied by Acme');
  });
});
