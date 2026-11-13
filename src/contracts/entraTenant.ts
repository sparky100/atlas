/**
 * Microsoft Entra sign-in (`org_entra_tenants`, migration 20261113030000).
 * An organisation records its company's Microsoft tenant ID once; anyone who
 * signs in from that tenant joins as a Viewer.
 *
 * Wire <-> storage mapping and the two pure rules the database repeats
 * (tenant-ID shape, and where the tenant lives on a stored Microsoft
 * identity). No I/O, no validation beyond constructing a well-typed value.
 */

import type { UUID } from './delta';

const TENANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/** A tenant ID as stored: trimmed and lowercase, or `null` if it is not a real tenant ID (a GUID that is not all zeros). Braces and surrounding whitespace from a paste are tolerated. */
export function normaliseTenantId(input: string): UUID | null {
  const cleaned = input.trim().replace(/^\{|\}$/g, '').toLowerCase();
  return TENANT_ID_PATTERN.test(cleaned) && cleaned !== NIL_TENANT_ID ? cleaned : null;
}

/** The literal shape of a row in `org_entra_tenants`. */
export interface OrgEntraTenantRow {
  org_id: UUID;
  tenant_id: UUID;
  created_by: UUID;
  created_at: string;
}

export interface OrgEntraTenant {
  orgId: UUID;
  tenantId: UUID;
  createdBy: UUID;
  createdAt: string;
}

export function toOrgEntraTenantRow(tenant: OrgEntraTenant): OrgEntraTenantRow {
  return { org_id: tenant.orgId, tenant_id: tenant.tenantId, created_by: tenant.createdBy, created_at: tenant.createdAt };
}

export function fromOrgEntraTenantRow(row: OrgEntraTenantRow): OrgEntraTenant {
  return { orgId: row.org_id, tenantId: row.tenant_id, createdBy: row.created_by, createdAt: row.created_at };
}

/** What `atlas.join_my_entra_org` reports after a sign-in. */
export const ENTRA_JOIN_RESULTS = ['joined', 'already_member', 'unknown_tenant', 'not_microsoft'] as const;
export type EntraJoinResult = (typeof ENTRA_JOIN_RESULTS)[number];

export function isEntraJoinResult(value: unknown): value is EntraJoinResult {
  return typeof value === 'string' && (ENTRA_JOIN_RESULTS as readonly string[]).includes(value);
}

/**
 * The tenant a stored Microsoft identity came from — mirrors
 * `atlas.entra_tenant_of_identity`: the `tid` claim if kept, otherwise the
 * tenant segment of the token issuer. `null` if neither is a valid tenant ID.
 */
export function tenantIdFromIdentityData(identityData: Record<string, unknown>): UUID | null {
  const custom = identityData.custom_claims;
  const customTid = typeof custom === 'object' && custom !== null ? (custom as Record<string, unknown>).tid : undefined;
  const tid = identityData.tid;
  const iss = identityData.iss;
  const candidates: unknown[] = [customTid, tid, typeof iss === 'string' ? /login\.microsoftonline\.com\/([0-9a-fA-F-]{36})\//.exec(iss)?.[1] : undefined];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^[0-9a-fA-F-]{36}$/.test(candidate)) return normaliseTenantId(candidate);
  }
  return null;
}
