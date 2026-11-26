import { describe, expect, it } from 'vitest';
import { assertCatalogueFilesAllowed } from './catalogueFilesGuard';

describe('catalogue files guard', () => {
  it('allows a local Supabase', () => {
    expect(() => { assertCatalogueFilesAllowed('http://127.0.0.1:54321'); }).not.toThrow();
    expect(() => { assertCatalogueFilesAllowed('http://localhost:54321'); }).not.toThrow();
  });
  it('refuses the live project and anything it cannot read', () => {
    expect(() => { assertCatalogueFilesAllowed('https://example.supabase.co'); }).toThrow(/maintained in the app/);
    expect(() => { assertCatalogueFilesAllowed('not a url'); }).toThrow(/maintained in the app/);
  });
});
