import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProductCatalogueContent } from '../src/contracts/productCatalogue';
import { mergeCatalogueFiles, renderMigration } from './buildCatalogueImport';

const claim = (statement: string, date: string, url = 'https://example.test/a') => ({
  position: 1, kind: 'functional' as const, statement, sourceUrl: url, sourceDate: date, reviewedBy: 'Pending review', reviewedAt: '2026-11-25',
});
const file = (sector: string, version: number, entries: ProductCatalogueContent['entries']): ProductCatalogueContent => ({
  sector: sector as ProductCatalogueContent['sector'], version, capabilityMapVersion: 2, status: 'draft',
  title: 'T', sourceDescription: 'S', licence: 'CC-BY-4.0', entries,
});
const entry = (code: string, claims: ReturnType<typeof claim>[], capCode = '9.1') => ({
  code, product: 'IBM Maximo', vendor: 'IBM', summary: 'Asset management.',
  capabilities: [{ code: capCode, name: 'Asset Care', howItSupports: 'Runs asset care.' }], claims,
});

describe('mergeCatalogueFiles', () => {
  it('makes one product from the same vendor and product in several sectors, keeping every sector link', () => {
    const merged = mergeCatalogueFiles([
      file('utility', 1, [entry('ibm-maximo-application-suite', [claim('It manages assets.', '2026-11-01')])]),
      file('electricity_network', 1, [entry('ibm-maximo', [claim('It manages assets.', '2026-11-10'), claim('It plans work.', '2026-11-10')], '9.2')]),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.links.map((link) => `${link.sector}:${link.code}`).sort()).toEqual(['electricity_network:9.2', 'utility:9.1']);
    // The same claim is counted once, at its newest date; a different claim is kept.
    expect(merged[0]?.claims.map((c) => [c.statement, c.sourceDate])).toEqual([['It manages assets.', '2026-11-10'], ['It plans work.', '2026-11-10']]);
  });

  it('uses only the newest file for a sector', () => {
    const merged = mergeCatalogueFiles([
      file('utility', 1, [entry('ibm-maximo', [claim('Old claim.', '2026-11-01')], '9.1')]),
      file('utility', 2, [entry('ibm-maximo', [claim('New claim.', '2026-11-20')], '9.3')]),
    ]);
    expect(merged[0]?.links.map((link) => link.code)).toEqual(['9.3']);
    expect(merged[0]?.claims.map((c) => c.statement)).toEqual(['New claim.']);
  });

  it('never carries a reviewer named in a file', () => {
    const merged = mergeCatalogueFiles([file('utility', 1, [entry('ibm-maximo', [{ ...claim('A claim.', '2026-11-01'), reviewedBy: 'Simon Parkinson' }])])]);
    expect(JSON.stringify(merged)).not.toContain('Simon');
    expect(JSON.stringify(merged)).not.toContain('reviewedBy');
  });
});

describe('the generated import migration', () => {
  it('matches what the files produce, so nobody has edited it by hand', async () => {
    const { readdir } = await import('node:fs/promises');
    const root = path.resolve(import.meta.dirname, '..');
    const files: ProductCatalogueContent[] = [];
    for (const sector of await readdir(path.join(root, 'content', 'catalogue'), { withFileTypes: true })) {
      if (!sector.isDirectory()) continue;
      for (const name of await readdir(path.join(root, 'content', 'catalogue', sector.name))) {
        if (name.endsWith('.json')) files.push(JSON.parse(await readFile(path.join(root, 'content', 'catalogue', sector.name, name), 'utf8')) as ProductCatalogueContent);
      }
    }
    const migration = await readFile(path.join(root, 'supabase', 'migrations', '20261126210000_catalogue_import_from_files.sql'), 'utf8');
    expect(migration).toBe(renderMigration(mergeCatalogueFiles(files)));
  });
});
