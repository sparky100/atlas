import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convertMulesoftExport, parseMulesoftExport, readableName, type MulesoftExportFile } from './mulesoft';
import { parseImportJsonText } from '../parseImportJson';

const FIXTURE = readFileSync(new URL('../fixtures/mulesoft/export.sandbox.json', import.meta.url), 'utf8');

function loadFixture(): MulesoftExportFile {
  const parsed = parseMulesoftExport(FIXTURE);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.file;
}

function names(rows: readonly Record<string, unknown>[]): unknown[] {
  return rows.map((row) => row.name);
}

describe('parseMulesoftExport', () => {
  it('reads the export script’s own output', () => {
    const file = loadFixture();
    expect(file.environments[0]?.name).toBe('Sandbox');
    expect(file.environments[0]?.apis).toHaveLength(2);
  });

  it('refuses text that is not JSON', () => {
    const result = parseMulesoftExport('not json');
    expect(result.ok).toBe(false);
  });

  it('refuses JSON that is not this export, naming where', () => {
    const result = parseMulesoftExport(JSON.stringify({ format: 'something-else', version: 1, environments: [] }));
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.error).toContain('export script');
  });
});

describe('convertMulesoftExport — no producer mapping', () => {
  const { importJson, report } = convertMulesoftExport(loadFixture());

  it('creates the platform, one interface per API and one system per client app', () => {
    expect(importJson.systems[0]).toMatchObject({ name: 'MuleSoft Anypoint', kind: 'integration_platform', vendor: 'MuleSoft', hosting_model: 'saas' });
    expect(importJson.systems.slice(1, 3)).toEqual([
      expect.objectContaining({ name: 'Test', platform: 'MuleSoft Anypoint', interface_type: 'api' }),
      expect.objectContaining({ name: 'Test 2', platform: 'MuleSoft Anypoint', interface_type: 'api' }),
    ]);
    expect(names(importJson.systems.slice(3))).toEqual(['PM', 'Field Service']);
    expect(importJson.changes).toEqual([]);
  });

  it('links each approved consumer straight to the interface with `uses`, one per app and API', () => {
    expect(importJson.relationships.map((r) => `${String(r.from)} ${String(r.type)} ${String(r.to)}`)).toEqual([
      'PM uses MuleSoft Anypoint · Test',
      'Field Service uses MuleSoft Anypoint · Test',
      'PM uses MuleSoft Anypoint · Test 2',
    ]);
    expect(importJson.relationships[0]).toMatchObject({ description: 'consumes', protocol_in: 'rest_api' });
    expect(importJson.relationships[0]?.quote).toContain('9531230');
  });

  it('never invents a producer: the backend host is reported for mapping instead', () => {
    expect(report.unmappedHosts).toEqual(['mprs.example.com']);
    expect(report.counts).toEqual({ interfaces: 2, consumers: 2, relationships: 3, flowsToProducer: 0 });
    expect(importJson.relationships.every((r) => r.type === 'uses')).toBe(true);
  });

  it('warns that the importer would merge “Test” and “Test 2”', () => {
    expect(report.nameCollisions).toEqual([{ names: ['Test', 'Test 2'] }]);
    expect(report.warnings.join('\n')).toContain('would be merged');
  });

  it('produces JSON the existing importer accepts without a single row error', () => {
    const parsed = parseImportJsonText(JSON.stringify(importJson), 'mulesoft.json');
    expect(parsed.errors).toEqual([]);
    expect(parsed.relationshipErrors).toEqual([]);
    expect(parsed.rows).toHaveLength(5);
    expect(parsed.relationshipRows).toHaveLength(3);
  });
});

describe('convertMulesoftExport — producer mapped', () => {
  const { importJson, report } = convertMulesoftExport(loadFixture(), { aliases: { 'MPRS.example.com': 'MPRS' } });

  it('turns consumers of a mapped API into flows to the producer, via the interface', () => {
    expect(importJson.relationships.map((r) => `${String(r.from)} ${String(r.type)} ${String(r.to)} via ${String(r.via)}`)).toEqual([
      'PM flows_to MPRS via MuleSoft Anypoint · Test',
      'Field Service flows_to MPRS via MuleSoft Anypoint · Test',
      'PM uses MuleSoft Anypoint · Test 2 via undefined',
    ]);
    expect(report.unmappedHosts).toEqual([]);
    expect(report.counts.flowsToProducer).toBe(2);
  });

  it('accepts the mapped output in the importer too', () => {
    const parsed = parseImportJsonText(JSON.stringify(importJson), 'mulesoft.json');
    expect(parsed.relationshipErrors).toEqual([]);
    expect(parsed.relationshipRows.map((row) => row.via)).toEqual(['MuleSoft Anypoint · Test', 'MuleSoft Anypoint · Test', null]);
  });
});

describe('convertMulesoftExport — edge cases', () => {
  it('is deterministic', () => {
    expect(convertMulesoftExport(loadFixture())).toEqual(convertMulesoftExport(loadFixture()));
  });

  it('skips contracts that are not approved, or have no application, and says so', () => {
    const file = loadFixture();
    const environment = file.environments[0];
    if (environment === undefined) throw new Error('fixture');
    environment.contracts['21241998'] = [
      { id: 1, status: 'REVOKED', application: { id: 5, name: 'Old App' } },
      { id: 2, status: 'APPROVED', application: null },
    ];
    const { importJson, report } = convertMulesoftExport(file);
    expect(importJson.relationships.map((r) => r.from)).toEqual(['PM', 'Field Service']);
    expect(names(importJson.systems)).not.toContain('Old App');
    expect(report.skippedContracts).toEqual([
      { contractId: '1', apiId: '21241998', reason: 'status REVOKED, not approved' },
      { contractId: '2', apiId: '21241998', reason: 'no client application on the contract' },
    ]);
  });

  it('warns when an API active-contract count disagrees with the approved contracts it lists', () => {
    const file = loadFixture();
    const api = file.environments[0]?.apis.find((a) => a.assetId === 'test');
    if (api === undefined) throw new Error('fixture');
    api.activeContractsCount = 5;
    const { report } = convertMulesoftExport(file);
    expect(report.warnings.join('\n')).toContain('reports 5 active contract(s) but the export holds 2 approved');
  });

  it('keeps an API with no contracts as an interface', () => {
    const file = loadFixture();
    const environment = file.environments[0];
    if (environment === undefined) throw new Error('fixture');
    environment.contracts = {};
    const { importJson, report } = convertMulesoftExport(file);
    expect(importJson.relationships).toEqual([]);
    expect(importJson.systems.filter((s) => s.platform !== undefined)).toHaveLength(2);
    expect(report.counts.consumers).toBe(0);
  });

  it('collapses several contracts from one app on one API into one relationship', () => {
    const file = loadFixture();
    const environment = file.environments[0];
    if (environment === undefined) throw new Error('fixture');
    environment.contracts['21241997'] = [
      { id: 10, status: 'APPROVED', application: { id: 7, name: 'PM' } },
      { id: 11, status: 'APPROVED', application: { id: 7, name: 'PM' } },
    ];
    const { importJson } = convertMulesoftExport(file);
    const toTest = importJson.relationships.filter((r) => r.to === 'MuleSoft Anypoint · Test');
    expect(toTest).toHaveLength(1);
    expect(toTest[0]?.quote).toContain('10, 11');
  });

  it('marks a deprecated API as retiring and prefers an instance label for the name', () => {
    const file = loadFixture();
    const api = file.environments[0]?.apis.find((a) => a.assetId === 'test');
    if (api === undefined) throw new Error('fixture');
    api.deprecated = true;
    api.instanceLabel = 'Orders API';
    api.description = 'Customer orders';
    const { importJson } = convertMulesoftExport(file);
    expect(importJson.systems.find((s) => s.name === 'Orders API')).toMatchObject({ lifecycle: 'retiring', description: 'Customer orders' });
  });

  it('suffixes interface names with the environment when the file has several', () => {
    const file = loadFixture();
    const environment = file.environments[0];
    if (environment === undefined) throw new Error('fixture');
    file.environments.push({ ...environment, name: 'Production' });
    const { importJson } = convertMulesoftExport(file);
    expect(names(importJson.systems.filter((s) => s.platform !== undefined))).toEqual(['Test (Sandbox)', 'Test 2 (Sandbox)', 'Test (Production)', 'Test 2 (Production)']);
  });

  it('reports an unreadable endpoint instead of guessing', () => {
    const file = loadFixture();
    const api = file.environments[0]?.apis.find((a) => a.assetId === 'test');
    if (api === undefined) throw new Error('fixture');
    api.endpointUri = 'not a url';
    const { report } = convertMulesoftExport(file);
    expect(report.warnings.join('\n')).toContain('could not read its endpoint');
    expect(report.unmappedHosts).toEqual([]);
  });

  it('uses a custom platform name everywhere it appears', () => {
    const { importJson } = convertMulesoftExport(loadFixture(), { platformName: 'Acme Anypoint' });
    expect(importJson.systems[0]?.name).toBe('Acme Anypoint');
    expect(importJson.systems[1]?.platform).toBe('Acme Anypoint');
    expect(importJson.relationships[0]?.to).toBe('Acme Anypoint · Test');
  });
});

describe('readableName', () => {
  it('turns asset ids into names', () => {
    expect(readableName('test-2')).toBe('Test 2');
    expect(readableName('customer_orders-api')).toBe('Customer Orders Api');
  });
});
