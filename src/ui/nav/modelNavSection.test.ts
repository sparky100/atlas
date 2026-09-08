import { describe, expect, it } from 'vitest';
import { modelNavSectionFor } from './modelNavSection';

describe('modelNavSectionFor', () => {
  it('treats the bare model path as home', () => {
    expect(modelNavSectionFor('')).toBe('home');
    expect(modelNavSectionFor('/')).toBe('home');
  });

  it('matches the capability map', () => {
    expect(modelNavSectionFor('/capability-map')).toBe('capability-map');
  });

  it('matches landscape and the whole zoom chain under it', () => {
    expect(modelNavSectionFor('/landscape')).toBe('landscape');
    expect(modelNavSectionFor('/context/abc')).toBe('landscape');
    expect(modelNavSectionFor('/container/abc')).toBe('landscape');
    expect(modelNavSectionFor('/component/abc')).toBe('landscape');
  });

  it('matches changes, list and detail', () => {
    expect(modelNavSectionFor('/changes')).toBe('changes');
    expect(modelNavSectionFor('/changes/abc')).toBe('changes');
  });

  it('matches versions, including the diff page', () => {
    expect(modelNavSectionFor('/versions')).toBe('versions');
    expect(modelNavSectionFor('/diff')).toBe('versions');
  });

  it('matches the review queue, list and detail', () => {
    expect(modelNavSectionFor('/review')).toBe('review');
    expect(modelNavSectionFor('/review/abc')).toBe('review');
  });

  it('returns null for a route with no persistent-nav section (an element page, the browse table)', () => {
    expect(modelNavSectionFor('/e/abc')).toBeNull();
    expect(modelNavSectionFor('/elements')).toBeNull();
  });
});
