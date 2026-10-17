import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAliasText, prepareMulesoftUpload } from './mulesoftUpload';
import { parseImportJsonText } from '../parseImportJson';

const FIXTURE = readFileSync(new URL('../fixtures/mulesoft/export.sandbox.json', import.meta.url), 'utf8');

describe('parseAliasText', () => {
  it('reads one mapping per line in any of the accepted separators, lower-casing the hostname', () => {
    const result = parseAliasText('MPRS.example.com = MPRS\nbilling.example.com -> Billing Engine\ncrm.example.com, CRM\n\n# a comment\n');
    expect(result.errors).toEqual([]);
    expect(result.aliases).toEqual({ 'mprs.example.com': 'MPRS', 'billing.example.com': 'Billing Engine', 'crm.example.com': 'CRM' });
  });

  it('reports a malformed line with its number and keeps reading', () => {
    const result = parseAliasText('mprs.example.com = MPRS\njust-a-word\n');
    expect(result.errors).toEqual(['Line 2: expected "hostname = Atlas element name".']);
    expect(result.aliases).toEqual({ 'mprs.example.com': 'MPRS' });
  });
});

describe('prepareMulesoftUpload', () => {
  it('converts the export into import JSON the existing importer reads cleanly, keeping the file name', () => {
    const result = prepareMulesoftUpload({ fileName: 'mulesoft-export.json', text: FIXTURE, aliasText: '' });
    if (!result.ok) throw new Error(result.error);
    expect(result.inputName).toBe('mulesoft-export.json');
    const parsed = parseImportJsonText(new TextDecoder().decode(result.bytes), result.inputName);
    expect(parsed.errors).toEqual([]);
    expect(parsed.relationshipErrors).toEqual([]);
    expect(result.summary).toBe('2 API interfaces, 2 client applications and 3 relationships on one MuleSoft platform.');
  });

  it('warns about the unmapped backend and the names the importer would merge', () => {
    const result = prepareMulesoftUpload({ fileName: 'x.json', text: FIXTURE, aliasText: '' });
    if (!result.ok) throw new Error(result.error);
    expect(result.warnings.some((w) => w.includes('mprs.example.com'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('would be merged'))).toBe(true);
  });

  it('uses the alias mapping to link consumers to the producer, and stops warning about that host', () => {
    const result = prepareMulesoftUpload({ fileName: 'x.json', text: FIXTURE, aliasText: 'mprs.example.com = MPRS' });
    if (!result.ok) throw new Error(result.error);
    expect(result.summary).toContain('(2 flows to a mapped backend)');
    expect(result.warnings.some((w) => w.includes('mprs.example.com'))).toBe(false);
    const parsed = parseImportJsonText(new TextDecoder().decode(result.bytes), 'x.json');
    expect(parsed.relationshipRows.filter((row) => row.type === 'flows_to')).toHaveLength(2);
  });

  it('uses saved external references the same way, and a typed line wins over a saved one', () => {
    const saved = prepareMulesoftUpload({ fileName: 'x.json', text: FIXTURE, aliasText: '', savedAliases: { 'mprs.example.com': 'MPRS' } });
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.summary).toContain('(2 flows to a mapped backend)');
    const overridden = prepareMulesoftUpload({ fileName: 'x.json', text: FIXTURE, aliasText: 'mprs.example.com = Other', savedAliases: { 'mprs.example.com': 'MPRS' } });
    if (!overridden.ok) throw new Error(overridden.error);
    expect(new TextDecoder().decode(overridden.bytes)).toContain('Other');
    expect(new TextDecoder().decode(overridden.bytes)).not.toContain('"MPRS"');
  });

  it('adds .json to a name without it, so the run is still read as JSON', () => {
    const result = prepareMulesoftUpload({ fileName: 'export', text: FIXTURE, aliasText: '' });
    expect(result.ok && result.inputName).toBe('export.json');
  });

  it('refuses a file that is not the export script’s output, and a bad mapping', () => {
    expect(prepareMulesoftUpload({ fileName: 'x.json', text: '{"systems":[]}', aliasText: '' })).toMatchObject({ ok: false });
    expect(prepareMulesoftUpload({ fileName: 'x.json', text: FIXTURE, aliasText: 'nonsense' })).toMatchObject({ ok: false });
  });
});
