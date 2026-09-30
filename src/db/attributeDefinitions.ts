/**
 * F1 ("custom attributes") PR2: org-defined attribute definitions — define,
 * reorder, deprecate. Thin, typed wrappers — same untyped-client
 * `eslint-disable` boundary organisations.ts's own module comment names.
 *
 * Reorder and deprecate are both plain, owner-gated column writes (no RPC —
 * see `20260914020000_attribute_definitions.sql`'s own comment on why
 * neither needs one): `setAttributeDefinitionOrder` is the one primitive
 * `useAttributeDefinitions.ts`'s `moveUp`/`moveDown` call twice to swap two
 * rows' `order_index`, mirroring the plan's own "a plain two-step client
 * update... under the same owner-only RLS/grant" decision, not the
 * delta/commit engine `useCapabilityReorder.ts` uses for a *model content*
 * reorder — this table is settings, not versioned model content.
 */
import type { AttributeDefinitionKind } from '../contracts/attributeSchema';
import { isCoreAttributeKey } from '../contracts/attributeSchema';
import type { ElementType, UUID } from '../contracts/delta';
import type { Client } from './client';
import type { AttributeDefinitionRow } from './types';

/** Every non-deprecated definition first, in display order, then every deprecated one — same "live content first" convention `listArchivedModelsForOrg`'s own split from `listModelsForOrg` uses, but as one list here since the settings panel shows both together (a deprecated row stays visible there, just marked, per the plan's own "define, reorder, deprecate" scope). */
export async function listAttributeDefinitions(supabase: Client, orgId: UUID): Promise<AttributeDefinitionRow[]> {
  const { data, error } = await supabase.from('attribute_definitions').select('*').eq('org_id', orgId).order('order_index');
  if (error) throw new Error(`listAttributeDefinitions: ${error.message}`);
  return (data as AttributeDefinitionRow[] | null) ?? [];
}

export interface CreateAttributeDefinitionInput {
  /** Minted by the caller (S-1) — never generated here. Use `crypto.randomUUID()` at the call site. */
  id: UUID;
  orgId: UUID;
  key: string;
  label: string;
  kind: AttributeDefinitionKind;
  /** `kind: 'select'` only — validated client-side before this is called (`useAttributeDefinitions.ts`'s own `create`). */
  options: readonly string[] | null;
  appliesTo: readonly ElementType[];
  required: boolean;
  description: string | null;
  /** Where this definition lands in display order — the caller's own current list length (append at the end), per `useAttributeDefinitions.ts`'s `create`. */
  orderIndex: number;
  createdBy: UUID;
}

export type CreateAttributeDefinitionResult = { status: 'created'; definition: AttributeDefinitionRow } | { status: 'duplicate_key' } | { status: 'reserved_key' };

/** Owner only (`attribute_definitions_insert`'s RLS). A second definition with the same key at this org is a duplicate, not a new row — `attribute_definitions_org_id_key_key`'s own unique constraint refuses it (`23505`, the same code `createInvite`'s own module comment names for its own unique-index conflict), returned here as a structured result rather than a raw Postgres error. A key that is already a *core* attribute's key is refused before the insert (`isCoreAttributeKey`) — the DB's unique constraint only covers one org's own custom keys, and nothing downstream de-duplicates a custom key against the core schema (`ElementPage`'s `[...schema, ...customFields]` concat renders both, the edit form shadows the core field, export drops the custom column), so this is the one place the collision can be stopped. */
export async function createAttributeDefinition(supabase: Client, input: CreateAttributeDefinitionInput): Promise<CreateAttributeDefinitionResult> {
  if (isCoreAttributeKey(input.key.trim())) return { status: 'reserved_key' };
  const row = {
    id: input.id,
    org_id: input.orgId,
    key: input.key.trim(),
    label: input.label.trim(),
    kind: input.kind,
    options: input.options,
    applies_to: input.appliesTo,
    required: input.required,
    description: input.description,
    order_index: input.orderIndex,
    created_by: input.createdBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('attribute_definitions').insert(row).select('*').single();
  if (error) {
    if (error.code === '23505') return { status: 'duplicate_key' };
    throw new Error(`createAttributeDefinition: ${error.message}`);
  }
  return { status: 'created', definition: data as AttributeDefinitionRow };
}

/** The one reorder primitive — a plain column write, owner-gated by RLS/grant, no guard trigger (no restrictive lifecycle state to gate *when*, per the migration's own comment). */
// A blocked update under RLS isn't a Postgres error on its own — the
// `attribute_definitions_update` policy's `using` clause just excludes the
// row from the scan, so a bare `.update()` reports an ordinary zero-row
// success. `.select('id')` and an explicit empty-result check turn that
// into a real, throwable failure (found live: a non-owner's writes below
// were silently resolving instead of rejecting).

export async function setAttributeDefinitionOrder(supabase: Client, id: UUID, orderIndex: number): Promise<void> {
  const { data, error } = await supabase.from('attribute_definitions').update({ order_index: orderIndex }).eq('id', id).select('id');
  if (error) throw new Error(`setAttributeDefinitionOrder: ${error.message}`);
  if (data.length === 0) throw new Error('setAttributeDefinitionOrder: not permitted or definition not found');
}

/** Soft-disable, mirroring `archiveModel`: hides the definition from future "add a value" pickers; a value already set on an element keeps rendering unchanged. */
export async function deprecateAttributeDefinition(supabase: Client, id: UUID): Promise<void> {
  const { data, error } = await supabase.from('attribute_definitions').update({ deprecated_at: new Date().toISOString() }).eq('id', id).select('id');
  if (error) throw new Error(`deprecateAttributeDefinition: ${error.message}`);
  if (data.length === 0) throw new Error('deprecateAttributeDefinition: not permitted or definition not found');
}

/** The reverse of deprecate — same plain column write, mirroring `restoreModel`. Same empty-result check as its sibling above; not separately reported as failing, but the same RLS silent-no-op risk applies. */
export async function restoreAttributeDefinition(supabase: Client, id: UUID): Promise<void> {
  const { data, error } = await supabase.from('attribute_definitions').update({ deprecated_at: null }).eq('id', id).select('id');
  if (error) throw new Error(`restoreAttributeDefinition: ${error.message}`);
  if (data.length === 0) throw new Error('restoreAttributeDefinition: not permitted or definition not found');
}
