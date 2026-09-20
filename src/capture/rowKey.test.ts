import { describe, expect, it } from 'vitest';
import { elementRowKey, relationshipRowKey } from './rowKey';

describe('elementRowKey', () => {
  it('prefers atlasId over everything else', () => {
    expect(elementRowKey({ elementType: 'system', name: 'CRM', atlasId: '11111111-1111-1111-1111-111111111111', sourceKeys: ['APP-42'] })).toBe('id:11111111-1111-1111-1111-111111111111');
  });

  it('falls back to the first source key, normalised', () => {
    expect(elementRowKey({ elementType: 'system', name: 'CRM', sourceKeys: ['APP-42', 'APP-43'] })).toBe('key:app 42');
  });

  it('falls back to name+type+parent when neither atlasId nor a source key is present', () => {
    expect(elementRowKey({ elementType: 'container', name: 'Billing', parentName: 'SAP' })).toBe('name:container:billing:sap');
  });

  it('uses an empty parent segment for a top-level row', () => {
    expect(elementRowKey({ elementType: 'system', name: 'CRM' })).toBe('name:system:crm:');
    expect(elementRowKey({ elementType: 'system', name: 'CRM', parentName: null })).toBe('name:system:crm:');
  });

  it('is stable across case/whitespace/diacritic variation (same normaliseName every other capture module uses)', () => {
    expect(elementRowKey({ elementType: 'system', name: '  CRM  ' })).toBe(elementRowKey({ elementType: 'system', name: 'crm' }));
  });

  it('differs by element type even when the name is identical', () => {
    expect(elementRowKey({ elementType: 'system', name: 'Billing' })).not.toBe(elementRowKey({ elementType: 'container', name: 'Billing' }));
  });
});

describe('relationshipRowKey', () => {
  it('composes type and both endpoint keys', () => {
    const fromKey = elementRowKey({ elementType: 'system', name: 'CRM' });
    const toKey = elementRowKey({ elementType: 'capability', name: 'Customer Service' });
    expect(relationshipRowKey('supports', fromKey, toKey)).toBe(`rel:supports:${fromKey}→${toKey}`);
  });

  it('differs when the direction is reversed', () => {
    const a = elementRowKey({ elementType: 'system', name: 'CRM' });
    const b = elementRowKey({ elementType: 'system', name: 'Billing' });
    expect(relationshipRowKey('uses', a, b)).not.toBe(relationshipRowKey('uses', b, a));
  });
});
