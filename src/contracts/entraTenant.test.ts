import { describe, expect, it } from 'vitest';
import { ENTRA_JOIN_RESULTS, fromOrgEntraTenantRow, isEntraJoinResult, normaliseTenantId, tenantIdFromIdentityData, toOrgEntraTenantRow } from './entraTenant';

const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';

describe('normaliseTenantId', () => {
  it('trims, lowercases and strips braces', () => {
    expect(normaliseTenantId(`  {${TENANT.toUpperCase()}} `)).toBe(TENANT);
  });
  it('rejects anything that is not a real tenant ID', () => {
    expect(normaliseTenantId('')).toBeNull();
    expect(normaliseTenantId('common')).toBeNull();
    expect(normaliseTenantId('organizations')).toBeNull();
    expect(normaliseTenantId('contoso.onmicrosoft.com')).toBeNull();
    expect(normaliseTenantId('00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(normaliseTenantId(`${TENANT}x`)).toBeNull();
  });
});

describe('org_entra_tenants round trip (RT)', () => {
  it('carries a tenant through row and back unchanged', () => {
    const tenant = { orgId: 'o1', tenantId: TENANT, createdBy: 'u1', createdAt: '2026-11-13T00:00:00Z' };
    expect(fromOrgEntraTenantRow(toOrgEntraTenantRow(tenant))).toEqual(tenant);
    expect(toOrgEntraTenantRow(tenant)).toEqual({ org_id: 'o1', tenant_id: TENANT, created_by: 'u1', created_at: '2026-11-13T00:00:00Z' });
  });
});

describe('join results', () => {
  it('recognises exactly the four results the database returns', () => {
    for (const r of ENTRA_JOIN_RESULTS) expect(isEntraJoinResult(r)).toBe(true);
    expect(isEntraJoinResult('banana')).toBe(false);
    expect(isEntraJoinResult(null)).toBe(false);
  });
});

describe('tenantIdFromIdentityData', () => {
  it('prefers custom_claims.tid, then tid, then the issuer', () => {
    expect(tenantIdFromIdentityData({ custom_claims: { tid: TENANT.toUpperCase() } })).toBe(TENANT);
    expect(tenantIdFromIdentityData({ tid: TENANT })).toBe(TENANT);
    expect(tenantIdFromIdentityData({ iss: `https://login.microsoftonline.com/${TENANT}/v2.0` })).toBe(TENANT);
  });
  it('returns null when no tenant can be read', () => {
    expect(tenantIdFromIdentityData({})).toBeNull();
    expect(tenantIdFromIdentityData({ iss: 'https://accounts.google.com' })).toBeNull();
    expect(tenantIdFromIdentityData({ tid: 'not-a-guid' })).toBeNull();
  });
});
