/**
 * Round-trip test for 20260910010000_capability_maps_title_summary.sql
 * (Sprint U4-2a item 4): `title`/`summary` write and read back through
 * `capability_maps` exactly as `scripts/loadCapabilityMaps.ts` writes
 * them and `listSeedableCapabilityMaps`/`getCapabilityMap` read them for
 * the picker (CapabilityMapImportPanel.tsx) — CLAUDE.md rule 1's
 * "migration, contract type, and round-trip test together."
 *
 * `capability_maps` is product content (ADR-012): no `org_id`, written
 * only by `scripts/loadCapabilityMaps.ts` as `service_role` (these tables
 * have no `authenticated` write grant at all) — so, unlike most of this
 * repo's other integration tests, this one writes as service_role
 * directly rather than through a signed-in user, the same convention
 * `capabilityMapTemplates.ts`'s own module comment describes for reads.
 *
 * Same "needs a real Supabase, not runnable in the authoring sandbox"
 * limitation as every other `*.integration.test.ts` in this repo — see
 * src/db/repository.integration.test.ts's own module comment.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { getCapabilityMap, listSeedableCapabilityMaps } from './capabilityMapTemplates';
import { createServiceRoleClient } from './client';
import { loadEnv } from './env';

const env = loadEnv();
const service = createServiceRoleClient(env);

const insertedMapIds: string[] = [];

afterAll(async () => {
  if (insertedMapIds.length === 0) return;
  await service.from('capability_maps').delete().in('id', insertedMapIds);
});

describe('capability_maps.title/summary round-trip', () => {
  it('writes and reads back title/summary exactly as loadCapabilityMaps.ts would', async () => {
    const mapId = randomUUID();
    insertedMapIds.push(mapId);
    const sector = `test_sector_${randomUUID().slice(0, 8)}`;

    const { error: insertError } = await service.from('capability_maps').insert({
      id: mapId,
      sector,
      version: 1,
      status: 'draft',
      title: 'Round-Trip Test Map',
      summary: 'Covers exactly what this test needs and nothing else.',
      source_description: 'Written directly by capabilityMapTemplates.integration.test.ts.',
    });
    if (insertError) throw new Error(`insert: ${insertError.message}`);

    const readBack = await getCapabilityMap(service, mapId);
    expect(readBack?.title).toBe('Round-Trip Test Map');
    expect(readBack?.summary).toBe('Covers exactly what this test needs and nothing else.');

    const listed = await listSeedableCapabilityMaps(service);
    const found = listed.find((m) => m.id === mapId);
    expect(found?.title).toBe('Round-Trip Test Map');
    expect(found?.summary).toBe('Covers exactly what this test needs and nothing else.');
  });

  it('reads back null for a row that predates these columns being populated — the migration added them nullable on purpose (its own comment explains why)', async () => {
    const mapId = randomUUID();
    insertedMapIds.push(mapId);
    const sector = `test_sector_${randomUUID().slice(0, 8)}`;

    const { error: insertError } = await service.from('capability_maps').insert({
      id: mapId,
      sector,
      version: 1,
      status: 'draft',
      source_description: 'No title/summary given — simulates a row loaded before this migration.',
    });
    if (insertError) throw new Error(`insert: ${insertError.message}`);

    const readBack = await getCapabilityMap(service, mapId);
    expect(readBack?.title).toBeNull();
    expect(readBack?.summary).toBeNull();
  });

  it('S1 item 13: "picker cards alphabetical by title" — a null title sorts after every real one', async () => {
    const suffix = randomUUID().slice(0, 8);
    const zTitle = `Zzz Alphabetical Test ${suffix}`;
    const aTitle = `Aaa Alphabetical Test ${suffix}`;

    const zId = randomUUID();
    const aId = randomUUID();
    const untitledId = randomUUID();
    insertedMapIds.push(zId, aId, untitledId);

    // Inserted Z-then-A-then-untitled — a passthrough of insertion order
    // (or a sort by sector/version alone, the pre-item-13 behaviour) would
    // not put them back in title order on its own. Distinct sectors avoid
    // `capability_maps_sector_version_key` (sector, version) colliding.
    const { error: insertError } = await service.from('capability_maps').insert([
      { id: zId, sector: `test_sector_z_${suffix}`, version: 1, status: 'draft', title: zTitle, source_description: 'Alphabetical-order test row (Z).' },
      { id: aId, sector: `test_sector_a_${suffix}`, version: 1, status: 'draft', title: aTitle, source_description: 'Alphabetical-order test row (A).' },
      { id: untitledId, sector: `test_sector_u_${suffix}`, version: 1, status: 'draft', source_description: 'Alphabetical-order test row (no title).' },
    ]);
    if (insertError) throw new Error(`insert: ${insertError.message}`);

    const listed = await listSeedableCapabilityMaps(service);
    const indexOf = (id: string) => listed.findIndex((m) => m.id === id);
    expect(indexOf(aId)).toBeGreaterThanOrEqual(0);
    expect(indexOf(zId)).toBeGreaterThan(indexOf(aId));
    expect(indexOf(untitledId)).toBeGreaterThan(indexOf(zId));
  });
});
