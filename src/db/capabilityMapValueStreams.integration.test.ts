/**
 * RT-15 (SPEC-data-model.md §10.1, ADR-023/F6): the two starter-map
 * content tables `supabase/migrations/20260921070000_value_streams.sql`
 * adds — `capability_map_value_stream_items` and
 * `capability_map_value_stream_enables` — written the way
 * `scripts/loadCapabilityMaps.ts` will write them (Step 7 of the F6
 * sprint; this test writes the same rows directly, as service_role) and
 * read back through `capabilityMapTemplates.ts`'s two new list functions;
 * the depth-two and stage-only triggers refuse what C22 refuses on the
 * seeded elements; and, once the map is published, every write to either
 * table fails the same "published and immutable" guard `capability_map_items`
 * already has.
 *
 * Same service_role-writes convention and same "needs a real Supabase, not
 * runnable in the authoring sandbox" limitation as
 * src/db/capabilityMapTemplates.integration.test.ts.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { listCapabilityMapValueStreamEnables, listCapabilityMapValueStreamItems } from './capabilityMapTemplates';
import { createServiceRoleClient } from './client';
import { loadEnv } from './env';

const env = loadEnv();
const service = createServiceRoleClient(env);

const insertedMapIds: string[] = [];

afterAll(async () => {
  if (insertedMapIds.length === 0) return;
  // Published maps can't have their children deleted (the guard) — flip
  // them back to draft first so the cascade from `capability_maps` succeeds.
  await service.from('capability_maps').update({ status: 'draft', published_at: null }).in('id', insertedMapIds);
  await service.from('capability_maps').delete().in('id', insertedMapIds);
});

/** A draft map with two capabilities, one stream and two stages under it — the smallest fixture that exercises both tables and every trigger. */
async function draftMapWithOneStream(): Promise<{ mapId: string; streamId: string; stageAId: string; stageBId: string }> {
  const mapId = randomUUID();
  insertedMapIds.push(mapId);
  const { error: mapError } = await service.from('capability_maps').insert({
    id: mapId,
    sector: `test_sector_${randomUUID().slice(0, 8)}`,
    version: 1,
    status: 'draft',
    title: 'Value streams round-trip fixture',
    summary: 'RT-15.',
    source_description: 'Written directly by capabilityMapValueStreams.integration.test.ts.',
  });
  if (mapError) throw new Error(`capability_maps: ${mapError.message}`);

  const { error: itemsError } = await service.from('capability_map_items').insert([
    { id: randomUUID(), map_id: mapId, code: '1', parent_code: null, name: 'Network Operations', level: 1, item_order: 10 },
    { id: randomUUID(), map_id: mapId, code: '1.1', parent_code: '1', name: 'Connections', level: 2, item_order: 10 },
  ]);
  if (itemsError) throw new Error(`capability_map_items: ${itemsError.message}`);

  const streamId = randomUUID();
  const stageAId = randomUUID();
  const stageBId = randomUUID();
  const { error: streamError } = await service.from('capability_map_value_stream_items').insert({ id: streamId, map_id: mapId, code: 'VS1', parent_code: null, name: 'Getting Connected', description: 'From enquiry to energised.', item_order: 10 });
  if (streamError) throw new Error(`stream: ${streamError.message}`);
  const { error: stagesError } = await service.from('capability_map_value_stream_items').insert([
    { id: stageAId, map_id: mapId, code: 'VS1.1', parent_code: 'VS1', name: 'Apply', description: null, item_order: 10 },
    { id: stageBId, map_id: mapId, code: 'VS1.2', parent_code: 'VS1', name: 'Quote', description: null, item_order: 20 },
  ]);
  if (stagesError) throw new Error(`stages: ${stagesError.message}`);

  return { mapId, streamId, stageAId, stageBId };
}

describe('RT-15: capability_map_value_stream_items / _enables round trip', () => {
  it('writes a stream, its stages and their enables links, and reads them back parent-first with resolved capability codes', async () => {
    const { mapId, streamId, stageAId, stageBId } = await draftMapWithOneStream();

    const { error: enablesError } = await service.from('capability_map_value_stream_enables').insert([
      { map_id: mapId, stage_code: 'VS1.1', capability_code: '1.1' },
      { map_id: mapId, stage_code: 'VS1.2', capability_code: '1.1' },
      { map_id: mapId, stage_code: 'VS1.2', capability_code: '1' },
    ]);
    if (enablesError) throw new Error(`enables: ${enablesError.message}`);

    const items = await listCapabilityMapValueStreamItems(service, mapId);
    expect(items.map((row) => row.code)).toEqual(['VS1', 'VS1.1', 'VS1.2']);
    expect(items[0]).toMatchObject({ id: streamId, parent_code: null, name: 'Getting Connected', description: 'From enquiry to energised.', item_order: 10 });
    expect(items[1]).toMatchObject({ id: stageAId, parent_code: 'VS1', name: 'Apply', description: null, item_order: 10 });
    expect(items[2]).toMatchObject({ id: stageBId, parent_code: 'VS1', name: 'Quote', item_order: 20 });

    const enables = await listCapabilityMapValueStreamEnables(service, mapId);
    expect(enables.map((row) => `${row.stage_code}→${row.capability_code}`)).toEqual(['VS1.1→1.1', 'VS1.2→1', 'VS1.2→1.1']);
  });

  it('refuses a stage under a stage, a stream that already has stages becoming a stage, and enables onto a stream — the content-table twins of C22', async () => {
    const { mapId } = await draftMapWithOneStream();

    const { error: depthError } = await service.from('capability_map_value_stream_items').insert({ id: randomUUID(), map_id: mapId, code: 'VS1.1.1', parent_code: 'VS1.1', name: 'Sub-stage', item_order: 10 });
    expect(depthError?.message).toMatch(/stage under a stage/);

    const { error: demoteError } = await service.from('capability_map_value_stream_items').update({ parent_code: 'VS1.1' }).eq('map_id', mapId).eq('code', 'VS1');
    expect(demoteError?.message).toMatch(/has stages of its own/);

    const { error: missingParentError } = await service.from('capability_map_value_stream_items').insert({ id: randomUUID(), map_id: mapId, code: 'VS9.1', parent_code: 'VS9', name: 'Orphan', item_order: 10 });
    expect(missingParentError?.message).toMatch(/not found in this map/);

    const { error: streamTargetError } = await service.from('capability_map_value_stream_enables').insert({ map_id: mapId, stage_code: 'VS1', capability_code: '1.1' });
    expect(streamTargetError?.message).toMatch(/is a stream, not a stage/);

    const { error: unknownCapabilityError } = await service.from('capability_map_value_stream_enables').insert({ map_id: mapId, stage_code: 'VS1.1', capability_code: '9.9' });
    expect(unknownCapabilityError).not.toBeNull();
  });

  it('once the map is published, every write to either table fails the same "published and immutable" guard capability_map_items has', async () => {
    const { mapId, stageAId } = await draftMapWithOneStream();
    const { error: enablesError } = await service.from('capability_map_value_stream_enables').insert({ map_id: mapId, stage_code: 'VS1.1', capability_code: '1.1' });
    if (enablesError) throw new Error(`enables: ${enablesError.message}`);

    const { error: publishError } = await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', mapId);
    if (publishError) throw new Error(`publish: ${publishError.message}`);

    const { error: insertItem } = await service.from('capability_map_value_stream_items').insert({ id: randomUUID(), map_id: mapId, code: 'VS2', parent_code: null, name: 'Too Late', item_order: 20 });
    expect(insertItem?.message).toMatch(/published and immutable/);
    const { error: updateItem } = await service.from('capability_map_value_stream_items').update({ name: 'Renamed' }).eq('id', stageAId);
    expect(updateItem?.message).toMatch(/published and immutable/);
    const { error: deleteItem } = await service.from('capability_map_value_stream_items').delete().eq('id', stageAId);
    expect(deleteItem?.message).toMatch(/published and immutable/);

    const { error: insertEnables } = await service.from('capability_map_value_stream_enables').insert({ map_id: mapId, stage_code: 'VS1.2', capability_code: '1.1' });
    expect(insertEnables?.message).toMatch(/published and immutable/);
    const { error: deleteEnables } = await service.from('capability_map_value_stream_enables').delete().eq('map_id', mapId).eq('stage_code', 'VS1.1');
    expect(deleteEnables?.message).toMatch(/published and immutable/);

    // Still readable, unchanged.
    const items = await listCapabilityMapValueStreamItems(service, mapId);
    expect(items).toHaveLength(3);
    expect(await listCapabilityMapValueStreamEnables(service, mapId)).toHaveLength(1);
  });
});
