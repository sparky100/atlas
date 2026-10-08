import { describe, expect, it } from 'vitest';
import { lookupColumnSynonym, resolveColumnRoles } from './columnSynonyms';

describe('the headers this product\'s own export writes', () => {
  it('reads Parent system, Parent capability and Parent as the parent role, and Atlas ID as the id', () => {
    expect(lookupColumnSynonym('Parent system')).toBe('parent');
    expect(lookupColumnSynonym('Parent capability')).toBe('parent');
    expect(lookupColumnSynonym('Parent')).toBe('parent');
    expect(lookupColumnSynonym('Atlas ID')).toBe('atlasId');
  });

  it('recognises every header the Elements export writes — so reading it back never needs the model', () => {
    const exportHeaders: Record<string, string> = {
      Name: 'name', Type: 'ignore', Owner: 'owner', Description: 'description', Vendor: 'vendor', Lifecycle: 'lifecycleStatus',
      Version: 'version', External: 'isExternal', 'External organisation': 'externalOrganisation', Introduced: 'introduced', 'Planned end': 'plannedEnd',
      'Vendor support ends': 'supportEndsAt', Criticality: 'criticality', 'Run cost': 'annualRunCost', Disposition: 'disposition',
      'Hosting model': 'hostingModel', 'Hosting provider': 'hostingProvider', Kind: 'kind', 'IT/OT domain': 'domain',
      Technology: 'technology', 'Lifecycle (module override)': 'lifecycleStatus', 'Criticality (module override)': 'criticality',
      'Hosting model (module override)': 'hostingModel', 'Hosting provider (module override)': 'hostingProvider', 'Domain (module override)': 'domain',
      'Actor type': 'actorType', Email: 'ownerEmail', 'Org unit': 'orgUnit', Reference: 'capabilityCode', Importance: 'importance',
      'Essential function (NIS/CAF)': 'essentialFunction', Order: 'ignore', 'Parent system': 'parent', 'Parent capability': 'parent', Parent: 'parent',
      Source: 'ignore', Age: 'ignore', 'Atlas ID': 'atlasId',
    };
    for (const [header, role] of Object.entries(exportHeaders)) expect([header, lookupColumnSynonym(header)]).toEqual([header, role]);
  });

  it('does not read the export\'s IT/OT domain as a business-area (capability) column', () => {
    expect(lookupColumnSynonym('IT/OT domain')).not.toBe('capability');
    expect(lookupColumnSynonym('Domain')).toBe('capability');
  });
});

describe('lookupColumnSynonym', () => {
  it('matches every example header from §5.2\'s own table, case/whitespace-insensitively', () => {
    expect(lookupColumnSynonym('Atlas ID')).toBe('atlasId');
    expect(lookupColumnSynonym('  atlas_id  ')).toBe('atlasId');
    expect(lookupColumnSynonym('CMDB ID')).toBe('sourceKey');
    expect(lookupColumnSynonym('Application name')).toBe('name');
    expect(lookupColumnSynonym('Live?')).toBe('lifecycleStatus');
    expect(lookupColumnSynonym('Go-live')).toBe('introduced');
    expect(lookupColumnSynonym('Retire by')).toBe('plannedEnd');
    expect(lookupColumnSynonym('SaaS?')).toBe('isExternal');
    expect(lookupColumnSynonym('Third party')).toBe('externalOrganisation');
    expect(lookupColumnSynonym('On-prem/cloud')).toBe('hostingModel');
    expect(lookupColumnSynonym('Data centre')).toBe('hostingProvider');
    expect(lookupColumnSynonym('Stack')).toBe('technology');
    expect(lookupColumnSynonym('Parent system')).toBe('parent');
    expect(lookupColumnSynonym('Accountable')).toBe('owner');
    expect(lookupColumnSynonym('Contact')).toBe('ownerEmail');
    expect(lookupColumnSynonym('Support team')).toBe('technicalOwner');
    expect(lookupColumnSynonym('Directorate')).toBe('capability');
    expect(lookupColumnSynonym('Upstream')).toBe('usesSystems');
    expect(lookupColumnSynonym('Downstream')).toBe('flowsTo');
    expect(lookupColumnSynonym('Middleware')).toBe('integrationPlatform');
    expect(lookupColumnSynonym('Comments')).toBe('notes');
  });

  it('is null for a header with no synonym-table entry', () => {
    expect(lookupColumnSynonym('Risk Score')).toBeNull();
    expect(lookupColumnSynonym('Maturity Rating')).toBeNull();
  });

  it('resolves the disclosed System/Application ambiguity to `name`, not `parent`', () => {
    expect(lookupColumnSynonym('System')).toBe('name');
    expect(lookupColumnSynonym('Application')).toBe('name');
  });
});

describe('resolveColumnRoles', () => {
  it('assigns confidence 1.0 to every synonym hit and skips a blank header', () => {
    const result = resolveColumnRoles({ headers: ['Application', '', 'Vendor'] });
    expect(result.roles[0]).toEqual({ role: 'name', confidence: 1, source: 'synonym' });
    expect(result.roles[1]).toBeNull();
    expect(result.roles[2]).toEqual({ role: 'vendor', confidence: 1, source: 'synonym' });
    expect(result.nameColumnIndex).toBe(0);
  });

  it('fills an unmapped header from the supplied LLM assignment', () => {
    const result = resolveColumnRoles({
      headers: ['Application', 'Weird Header'],
      llmAssignments: new Map([[1, { role: 'description', confidence: 0.82 }]]),
    });
    expect(result.roles[1]).toEqual({ role: 'description', confidence: 0.82, source: 'llm' });
    expect(result.warnings).toEqual([]);
  });

  it('records LOW_MAPPING_CONFIDENCE for an LLM assignment below 0.70', () => {
    const result = resolveColumnRoles({
      headers: ['Application', 'Weird Header'],
      llmAssignments: new Map([[1, { role: 'description', confidence: 0.5 }]]),
    });
    expect(result.warnings).toEqual([{ code: 'LOW_MAPPING_CONFIDENCE', column: 'Weird Header', confidence: 0.5 }]);
  });

  it('demotes a second `name` column to `ignore`, always preferring a synonym-sourced `name` over an LLM-guessed one', () => {
    const result = resolveColumnRoles({
      headers: ['Weird Header First', 'Application'],
      llmAssignments: new Map([[0, { role: 'name', confidence: 0.8 }]]),
    });
    expect(result.nameColumnIndex).toBe(1);
    expect(result.roles[0]).toMatchObject({ role: 'ignore' });
    expect(result.roles[1]).toMatchObject({ role: 'name', source: 'synonym' });
  });

  it('returns nameColumnIndex: null when nothing resolves to `name`', () => {
    const result = resolveColumnRoles({ headers: ['Vendor', 'Status'] });
    expect(result.nameColumnIndex).toBeNull();
  });
});
