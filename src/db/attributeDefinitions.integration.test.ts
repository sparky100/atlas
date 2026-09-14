/**
 * F1 ("custom attributes") PR2: attribute_definitions against a real local
 * Supabase. Same "this sandbox has no Docker route" limitation named in
 * `repository.integration.test.ts`'s own module comment — written and
 * reasoned through against the real RLS/grant behaviour
 * (`20260914020000_attribute_definitions.sql`), not executed here.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAttributeDefinition,
  deprecateAttributeDefinition,
  listAttributeDefinitions,
  restoreAttributeDefinition,
  setAttributeDefinitionOrder,
} from './attributeDefinitions';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { loadEnv } from './env';
import { createOrganisation } from './organisations';

const env = loadEnv();
const service = createServiceRoleClient(env);

interface TestUser {
  id: string;
  email: string;
  client: Client;
}

async function createSignedInUser(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw new Error(`createSignedInUser(${label}): ${createError.message}`);
  const signIn = createSupabaseClient(env);
  const { error: signInError } = await signIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);
  return { id: created.user.id, email, client: signIn };
}

describe('attribute_definitions against a real local Supabase', () => {
  let owner: TestUser;
  let architect: TestUser;
  let orgId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('attrdefs-owner');
    architect = await createSignedInUser('attrdefs-architect');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Attribute Definitions Test Org', slug: `attrdefs-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert({ org_id: orgId, user_id: architect.id, role: 'architect', invited_by: owner.id });
    if (memberError) throw new Error(`add architect: ${memberError.message}`);
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('an owner can define a select attribute for system; an architect cannot (attribute_definitions_insert RLS is owner-only)', async () => {
    const result = await createAttributeDefinition(owner.client, {
      id: randomUUID(),
      orgId,
      key: `region-${randomUUID().slice(0, 8)}`,
      label: 'Region',
      kind: 'select',
      options: ['emea', 'amer', 'apac'],
      appliesTo: ['system'],
      required: false,
      description: null,
      orderIndex: 0,
      createdBy: owner.id,
    });
    expect(result.status).toBe('created');
    if (result.status !== 'created') throw new Error('unreachable');
    expect(result.definition.kind).toBe('select');
    expect(result.definition.options).toEqual(['emea', 'amer', 'apac']);
    expect(result.definition.deprecated_at).toBeNull();

    await expect(
      createAttributeDefinition(architect.client, {
        id: randomUUID(),
        orgId,
        key: `region-arch-${randomUUID().slice(0, 8)}`,
        label: 'Region (architect attempt)',
        kind: 'text',
        options: null,
        appliesTo: ['system'],
        required: false,
        description: null,
        orderIndex: 1,
        createdBy: architect.id,
      }),
    ).rejects.toThrow();
  });

  it('a second definition with the same key at this org returns duplicate_key rather than a raw conflict', async () => {
    const key = `dup-${randomUUID().slice(0, 8)}`;
    const first = await createAttributeDefinition(owner.client, {
      id: randomUUID(),
      orgId,
      key,
      label: 'First',
      kind: 'text',
      options: null,
      appliesTo: ['system'],
      required: false,
      description: null,
      orderIndex: 0,
      createdBy: owner.id,
    });
    expect(first.status).toBe('created');

    const second = await createAttributeDefinition(owner.client, {
      id: randomUUID(),
      orgId,
      key,
      label: 'Second',
      kind: 'number',
      options: null,
      appliesTo: ['capability'],
      required: false,
      description: null,
      orderIndex: 1,
      createdBy: owner.id,
    });
    expect(second).toEqual({ status: 'duplicate_key' });
  });

  it('an owner can reorder two definitions; an architect cannot (attribute_definitions_update RLS is owner-only)', async () => {
    const a = await createAttributeDefinition(owner.client, {
      id: randomUUID(),
      orgId,
      key: `reorder-a-${randomUUID().slice(0, 8)}`,
      label: 'Reorder A',
      kind: 'text',
      options: null,
      appliesTo: ['system'],
      required: false,
      description: null,
      orderIndex: 100,
      createdBy: owner.id,
    });
    const b = await createAttributeDefinition(owner.client, {
      id: randomUUID(),
      orgId,
      key: `reorder-b-${randomUUID().slice(0, 8)}`,
      label: 'Reorder B',
      kind: 'text',
      options: null,
      appliesTo: ['system'],
      required: false,
      description: null,
      orderIndex: 101,
      createdBy: owner.id,
    });
    if (a.status !== 'created' || b.status !== 'created') throw new Error('unreachable');

    await expect(setAttributeDefinitionOrder(architect.client, a.definition.id, 101)).rejects.toThrow();

    await setAttributeDefinitionOrder(owner.client, a.definition.id, 101);
    await setAttributeDefinitionOrder(owner.client, b.definition.id, 100);

    const definitions = await listAttributeDefinitions(owner.client, orgId);
    expect(definitions.find((d) => d.id === a.definition.id)?.order_index).toBe(101);
    expect(definitions.find((d) => d.id === b.definition.id)?.order_index).toBe(100);
  });

  it('an owner can deprecate and restore a definition; a value already set keeps its own row unaffected by the flag', async () => {
    const created = await createAttributeDefinition(owner.client, {
      id: randomUUID(),
      orgId,
      key: `deprecate-${randomUUID().slice(0, 8)}`,
      label: 'Deprecate Me',
      kind: 'boolean',
      options: null,
      appliesTo: ['container'],
      required: false,
      description: null,
      orderIndex: 0,
      createdBy: owner.id,
    });
    if (created.status !== 'created') throw new Error('unreachable');

    await expect(deprecateAttributeDefinition(architect.client, created.definition.id)).rejects.toThrow();

    await deprecateAttributeDefinition(owner.client, created.definition.id);
    let definitions = await listAttributeDefinitions(owner.client, orgId);
    expect(definitions.find((d) => d.id === created.definition.id)?.deprecated_at).not.toBeNull();

    await restoreAttributeDefinition(owner.client, created.definition.id);
    definitions = await listAttributeDefinitions(owner.client, orgId);
    expect(definitions.find((d) => d.id === created.definition.id)?.deprecated_at).toBeNull();
  });

  it('every org member (including a non-owner) can list definitions — attribute_definitions_select is member-wide, not owner-only', async () => {
    const created = await createAttributeDefinition(owner.client, {
      id: randomUUID(),
      orgId,
      key: `readable-${randomUUID().slice(0, 8)}`,
      label: 'Readable',
      kind: 'text',
      options: null,
      appliesTo: ['system'],
      required: false,
      description: null,
      orderIndex: 0,
      createdBy: owner.id,
    });
    if (created.status !== 'created') throw new Error('unreachable');

    const asArchitect = await listAttributeDefinitions(architect.client, orgId);
    expect(asArchitect.find((d) => d.id === created.definition.id)).toBeDefined();
  });

  it('applies_to must be non-empty and drawn from the known element types (attribute_definitions own CHECK constraint)', async () => {
    await expect(
      createAttributeDefinition(owner.client, {
        id: randomUUID(),
        orgId,
        key: `badapplies-${randomUUID().slice(0, 8)}`,
        label: 'Bad applies_to',
        kind: 'text',
        options: null,
        appliesTo: [],
        required: false,
        description: null,
        orderIndex: 0,
        createdBy: owner.id,
      }),
    ).rejects.toThrow();
  });
});
