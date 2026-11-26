/**
 * Playwright global setup: the real starter capability maps, so the suite
 * runs against a freshly reset local database (`pnpm db:reset`) with no
 * manual release step first. Test setup, not application code (CLAUDE.md
 * rule 7): the same `content/capability-maps` files and the same
 * `scripts/loadCapabilityMaps.ts` / `scripts/publishCapabilityMap.ts` a
 * release runs.
 *
 * The value-streams golden path needs the electricity map at v4 (the first
 * version with value streams) published; loading alone leaves it a draft,
 * as its content file says. Loading skips any map already published, and
 * v4 is published only if it isn't yet, so a re-run changes nothing.
 */
import { assertLocalTestEnvironment } from '../src/db/assertLocalSupabase';
import { createServiceRoleClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { loadAllCapabilityMaps } from '../scripts/loadCapabilityMaps';
import { publishCapabilityMap } from '../scripts/publishCapabilityMap';
import { loadCatalogueVersion } from '../scripts/loadCatalogue';

const PUBLISHED_FOR_TESTS: readonly { sector: string; version: number }[] = [{ sector: 'electricity_network', version: 4 }];
const CATALOGUES_FOR_TESTS: readonly { sector: string; version: number }[] = [{ sector: 'electricity_network', version: 1 }];

export default async function globalSetup(): Promise<void> {
  assertLocalTestEnvironment();
  const supabase = createServiceRoleClient(loadEnv());
  await loadAllCapabilityMaps(supabase);
  for (const { sector, version } of PUBLISHED_FOR_TESTS) {
    const { data, error } = await supabase.from('capability_maps').select('status').eq('sector', sector).eq('version', version).maybeSingle();
    if (error) throw new Error(`globalSetup: reading ${sector} v${String(version)}: ${error.message}`);
    if (data?.status === 'draft') await publishCapabilityMap(supabase, sector, version);
  }
  // The reviewed product catalogue for the same sector, published so a
  // decision about an electricity capability lists real products
  // (golden-path-product-option). Test setup only; the live catalogue is
  // published by a platform admin.
  for (const { sector, version } of CATALOGUES_FOR_TESTS) {
    await loadCatalogueVersion(supabase, sector, version);
    const { data, error } = await supabase.from('product_catalogues').select('id, status').eq('sector', sector).eq('version', version).maybeSingle();
    if (error) throw new Error(`globalSetup: reading the ${sector} catalogue v${String(version)}: ${error.message}`);
    if (data?.status === 'draft') {
      const published = await supabase.from('product_catalogues').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', data.id);
      if (published.error) throw new Error(`globalSetup: publishing the ${sector} catalogue: ${published.error.message}`);
    }
  }
}
