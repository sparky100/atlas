/**
 * Stabilisation (S4): `createAliasIfAbsent` — renaming a converted module
 * failed outright because the conversion had already recorded the old name
 * as an alias, and `aliases_model_id_alias_type_value_idx` is model-wide.
 * Recording a name the model already holds is now a no-op returning null;
 * any other failure still throws.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAliasIfAbsent } from './aliases';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { loadEnv } from './env';
import { createModel } from './models';
import { createOrganisation } from './organisations';
import { getOrCreateManualSource } from './sources';

const env = loadEnv();
const service = createServiceRoleClient(env);

describe('createAliasIfAbsent against a real local Supabase', () => {
  let client: Client;
  let userId: string;
  let orgId: string;
  let modelId: string;
  let sourceId: string;

  beforeAll(async () => {
    const email = `aliasifabsent-${randomUUID()}@example.test`;
    const password = `${randomUUID()}Aa1!`;
    const { data: created, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    userId = created.user.id;
    client = createSupabaseClient(env);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(signInError.message);

    orgId = randomUUID();
    await createOrganisation(client, { id: orgId, name: 'Alias If Absent Org', slug: `aliasifabsent-${orgId.slice(0, 8)}`, createdBy: userId });
    modelId = randomUUID();
    await createModel(client, { id: modelId, orgId, name: 'Alias If Absent Model', slug: `aliasifabsent-model-${modelId.slice(0, 8)}`, createdBy: userId });
    sourceId = (await getOrCreateManualSource(client, { id: randomUUID(), orgId, modelId, userId })).id;
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  const input = (elementId: string, aliasValue: string) => ({ id: randomUUID(), orgId, modelId, elementId, aliasValue, aliasType: 'name' as const, sourceId, createdBy: userId });

  it('records a new name alias', async () => {
    const row = await createAliasIfAbsent(client, input(randomUUID(), 'Freight Tracker'));
    expect(row?.alias_value).toBe('Freight Tracker');
  });

  it('returns null, without failing, for a name this model already records (any case)', async () => {
    const elementId = randomUUID();
    await createAliasIfAbsent(client, input(elementId, 'Customs Gateway'));
    await expect(createAliasIfAbsent(client, input(elementId, 'customs gateway'))).resolves.toBeNull();
    const { data } = await client.from('aliases').select('id').eq('model_id', modelId).ilike('alias_value', 'customs gateway');
    expect(data).toHaveLength(1);
  });

  it('still throws for any other failure (an alias type a client may not insert)', async () => {
    await expect(createAliasIfAbsent(client, { ...input(randomUUID(), 'Old Id'), aliasType: 'merged_id' as never })).rejects.toThrow(/createAlias/);
  });
});
