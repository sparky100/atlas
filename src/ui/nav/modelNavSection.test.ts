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
  });

  it('files integrations under Reports', () => {
    expect(modelNavSectionFor('/integrations')).toBe('reports');
  });

  it('matches Ask Atlas', () => {
    expect(modelNavSectionFor('/ask')).toBe('ask');
  });

  it('matches the roadmap', () => {
    expect(modelNavSectionFor('/roadmap')).toBe('roadmap');
  });

  it('matches the Work overview', () => {
    expect(modelNavSectionFor('/work')).toBe('work');
  });

  it('matches goals', () => {
    expect(modelNavSectionFor('/goals')).toBe('goals');
  });

  it('matches principles', () => {
    expect(modelNavSectionFor('/principles')).toBe('principles');
  });

  it('matches changes, list and detail', () => {
    expect(modelNavSectionFor('/changes')).toBe('changes');
    expect(modelNavSectionFor('/changes/abc')).toBe('changes');
  });

  it('matches decisions, list and detail', () => {
    expect(modelNavSectionFor('/decisions')).toBe('decisions');
    expect(modelNavSectionFor('/decisions/abc')).toBe('decisions');
    expect(modelNavSectionFor('/projects')).toBe('projects');
    expect(modelNavSectionFor('/projects/abc')).toBe('projects');
  });

  it('matches versions, including the diff page', () => {
    expect(modelNavSectionFor('/versions')).toBe('versions');
    expect(modelNavSectionFor('/diff')).toBe('versions');
  });

  it('treats the review queue, its detail pages and capture review as part of Changes (F9: a tab, not a nav item)', () => {
    expect(modelNavSectionFor('/review')).toBe('changes');
    expect(modelNavSectionFor('/review/abc')).toBe('changes');
    expect(modelNavSectionFor('/review/capture/abc')).toBe('changes');
  });

  it('treats the Reports hub and each report it lists as Reports (F9 step 3)', () => {
    expect(modelNavSectionFor('/reports')).toBe('reports');
    expect(modelNavSectionFor('/boundary-crossings')).toBe('reports');
    expect(modelNavSectionFor('/external-interfaces')).toBe('reports');
    expect(modelNavSectionFor('/duplicates')).toBe('reports');
  });

  it('matches the Elements browse table (F9)', () => {
    expect(modelNavSectionFor('/elements')).toBe('elements');
  });

  it('returns null for a route with no persistent-nav section (an element page)', () => {
    expect(modelNavSectionFor('/e/abc')).toBeNull();
  });

  it('does not mistake a path that merely starts with "elements" for the browse table', () => {
    expect(modelNavSectionFor('/elementsfoo')).toBeNull();
  });
});
