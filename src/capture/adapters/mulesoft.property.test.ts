/**
 * For any well-formed export: conversion is deterministic, every relationship
 * endpoint and `via` it emits names a system the same file defines (or the
 * mapped producer), and a relationship exists only for an approved contract.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { convertMulesoftExport, type MulesoftExportFile } from './mulesoft';

const appArb = fc.record({ id: fc.integer({ min: 1, max: 6 }), name: fc.constantFrom('PM', 'Field Service', 'Billing Portal', 'CRM') });
const contractArb = fc.record({ id: fc.integer({ min: 1, max: 1000 }), status: fc.constantFrom('APPROVED', 'REVOKED', 'PENDING'), application: fc.option(appArb, { nil: null }) });
const apiArb = (id: number) => fc.record({ id: fc.constant(id), assetId: fc.constantFrom('orders', 'billing-api', 'customer_search', 'inventory'), endpointUri: fc.option(fc.constantFrom('http://a.example.com', 'https://b.example.com/x', 'bad uri'), { nil: null }) });

const fileArb: fc.Arbitrary<MulesoftExportFile> = fc.integer({ min: 0, max: 4 }).chain((count) => {
  const ids = Array.from({ length: count }, (_, i) => 100 + i);
  return fc
    .tuple(fc.tuple(...ids.map((id) => apiArb(id))), fc.tuple(...ids.map(() => fc.array(contractArb, { maxLength: 4 }))))
    .map(([apis, contractLists]) => ({
      format: 'atlas-mulesoft-export' as const,
      version: 1 as const,
      organizationId: 'org',
      environments: [{ name: 'Production', apis, contracts: Object.fromEntries(ids.map((id, i) => [String(id), contractLists[i] ?? []])) }],
    }));
});

describe('MuleSoft converter properties', () => {
  it('is deterministic', () => {
    fc.assert(fc.property(fileArb, (file) => {
      expect(convertMulesoftExport(file, { aliases: { 'a.example.com': 'Backend A' } })).toEqual(convertMulesoftExport(file, { aliases: { 'a.example.com': 'Backend A' } }));
    }));
  });

  it('only emits relationships between systems it defines, plus the mapped producer', () => {
    fc.assert(fc.property(fileArb, (file) => {
      const { importJson } = convertMulesoftExport(file, { aliases: { 'a.example.com': 'Backend A' } });
      const defined = new Set(importJson.systems.map((s) => String(s.name)));
      const interfaces = new Set(importJson.systems.filter((s) => s.platform !== undefined).map((s) => `${String(s.platform)} · ${String(s.name)}`));
      for (const relationship of importJson.relationships) {
        expect(defined.has(String(relationship.from))).toBe(true);
        if (relationship.type === 'uses') expect(interfaces.has(String(relationship.to))).toBe(true);
        else {
          expect(relationship.to).toBe('Backend A');
          expect(interfaces.has(String(relationship.via))).toBe(true);
        }
      }
    }));
  });

  it('never creates more relationships than approved contracts with an application', () => {
    fc.assert(fc.property(fileArb, (file) => {
      const { importJson } = convertMulesoftExport(file);
      const approved = Object.values(file.environments[0]?.contracts ?? {}).flat().filter((c) => c.status === 'APPROVED' && c.application !== null && c.application !== undefined).length;
      expect(importJson.relationships.length).toBeLessThanOrEqual(approved);
    }));
  });
});
