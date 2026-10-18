/**
 * Import plan step 5: what a second upload of a later MuleSoft export does.
 * The run stores the converted JSON and re-imports against it (SPEC-capture
 * §9), so "same export gives the same rows" and "a removed API is a `gone`
 * interface" are decided here, in the converter's output and the existing
 * diff — these tests pin both without a database.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CandidateProposal } from '../../contracts/capture';
import type { ElementsHeadRow } from '../../contracts/rows';
import { buildMatchIndex } from '../matchIndex';
import { diffAgainstPreviousImport, type PreviousCandidateForDiff, type ThisRunCandidateForDiff } from '../reimportDiff';
import { elementRowKey } from '../rowKey';
import { convertMulesoftExport, parseMulesoftExport, type MulesoftExportFile, type MulesoftImportJson } from './mulesoft';

const FIXTURE = readFileSync(new URL('../fixtures/mulesoft/export.sandbox.json', import.meta.url), 'utf8');
const ALIASES = { 'mprs.example.com': 'MPRS' };

function load(): MulesoftExportFile {
  const parsed = parseMulesoftExport(FIXTURE);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.file;
}

function convert(file: MulesoftExportFile): MulesoftImportJson {
  return convertMulesoftExport(file, { aliases: ALIASES }).importJson;
}

function clone(file: MulesoftExportFile): MulesoftExportFile {
  return JSON.parse(JSON.stringify(file)) as MulesoftExportFile;
}

function systemNames(json: MulesoftImportJson): string[] {
  return json.systems.map((row) => String(row.name));
}

function relationshipKeys(json: MulesoftImportJson): string[] {
  return json.relationships.map((row) => [row.type, row.from, row.to, row.via ?? ''].map(String).join('|'));
}

/** The row's own key and proposal as the importer would see them: `quote` and `confidence` are provenance, not attributes. */
function asCandidate(row: Record<string, unknown>): { rowKey: string; proposal: CandidateProposal } {
  const { name, platform } = row;
  const attributes = Object.fromEntries(Object.entries(row).filter(([key]) => !['name', 'platform', 'quote', 'confidence'].includes(key)));
  const isInterface = typeof platform === 'string';
  return {
    rowKey: elementRowKey({ elementType: isInterface ? 'container' : 'system', name: String(name), parentName: isInterface ? platform : null }),
    proposal: { kind: 'element', elementType: isInterface ? 'container' : 'system', name: String(name), parent: isInterface ? { kind: 'unresolved', text: platform } : null, attributes },
  };
}

describe('re-importing a MuleSoft export', () => {
  const first = convert(load());

  it('gives byte-identical rows for a later export of the same thing, whatever order the CLI listed things in', () => {
    const later = clone(load());
      for (const environment of later.environments) {
      environment.apis.reverse();
      for (const contracts of Object.values(environment.contracts)) contracts.reverse();
    }
    expect(JSON.stringify(convert(later))).toBe(JSON.stringify(first));
  });

  it('drops a removed API and its contracts from the rows and changes nothing else', () => {
    const later = clone(load());
    const environment = later.environments[0];
    if (!environment) throw new Error('fixture has no environment');
    environment.apis = environment.apis.filter((api) => String(api.id) !== '21241998');
    delete environment.contracts['21241998'];
    const second = convert(later);

    expect(systemNames(second)).toEqual(systemNames(first).filter((name) => name !== 'Test 2'));
    expect(relationshipKeys(second)).toEqual(relationshipKeys(first).filter((key) => !key.includes('Test 2')));
    const unchanged = first.systems.filter((row) => row.name !== 'Test 2');
    expect(second.systems).toEqual(unchanged);
  });

  it('adds exactly one relationship for a newly approved contract', () => {
    const later = clone(load());
    const contracts = later.environments[0]?.contracts['21241998'];
    const template = contracts?.[0];
    if (!contracts || !template) throw new Error('fixture has no contract');
    const fieldService = later.environments[0]?.contracts['21241997']?.find((contract) => contract.application?.name === 'Field Service');
    if (!fieldService?.application) throw new Error('fixture has no Field Service contract');
    contracts.push({ ...template, id: 9999999, application: fieldService.application });
    const second = convert(later);

    expect(relationshipKeys(second).filter((key) => !relationshipKeys(first).includes(key))).toEqual(['uses|Field Service|MuleSoft Anypoint · Test 2|']);
    expect(second.systems).toEqual(first.systems);
  });

  it('treats a revoked contract as a missing relationship, with the interface still present', () => {
    const later = clone(load());
    const revoked = later.environments[0]?.contracts['21241998']?.[0];
    if (!revoked) throw new Error('fixture has no contract');
    revoked.status = 'REVOKED';
    const second = convert(later);

    expect(systemNames(second)).toContain('Test 2');
    expect(relationshipKeys(second)).toEqual(relationshipKeys(first).filter((key) => !key.includes('Test 2')));
  });
});

describe('the existing re-import diff over two MuleSoft runs', () => {
  const first = convert(load());
  const later = clone(load());
  const environment = later.environments[0];
  if (!environment) throw new Error('fixture has no environment');
  environment.apis = environment.apis.filter((api) => String(api.id) !== '21241998');
  delete environment.contracts['21241998'];
  const second = convert(later);

  const previous: PreviousCandidateForDiff[] = first.systems.map((row) => {
    const candidate = asCandidate(row);
    const elementType = candidate.proposal.kind === 'element' ? candidate.proposal.elementType : 'system';
    return { rowKey: candidate.rowKey, kind: 'element', elementType, relationshipType: null, proposal: candidate.proposal, evidence: { sourceRef: { kind: 'sheet', sheet: 'systems', range: 'A1' }, passage: String(row.quote), extractor: 'sheet-mapping', attributeConfidence: {}, warnings: [] }, decision: 'accepted' };
  });
  const thisRun: ThisRunCandidateForDiff[] = second.systems.map((row) => asCandidate(row));
  const mainHead: ElementsHeadRow[] = [
    { element_id: 'plat', element_type: 'system', name: 'MuleSoft Anypoint', parent_id: null, attributes: {}, exists_delta_id: 'd1' },
    { element_id: 'if-1', element_type: 'container', name: 'Test', parent_id: 'plat', attributes: {}, exists_delta_id: 'd2' },
    { element_id: 'if-2', element_type: 'container', name: 'Test 2', parent_id: 'plat', attributes: {}, exists_delta_id: 'd3' },
  ];
  const result = diffAgainstPreviousImport(thisRun, previous, buildMatchIndex(mainHead, []));

  it('reports every row still in the file as unchanged', () => {
    expect([...result.reimportStatusByRowKey.values()].every((status) => status === 'unchanged')).toBe(true);
    expect(result.reimportStatusByRowKey.size).toBe(second.systems.length);
  });

  it('reports the removed API as the only gone element, left for a person to decide', () => {
    expect(result.goneCandidates).toHaveLength(1);
    expect(result.goneCandidates[0]?.proposal).toMatchObject({ name: 'Test 2' });
  });
});
