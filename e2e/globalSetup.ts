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
import { createServiceRoleClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { loadAllCapabilityMaps } from '../scripts/loadCapabilityMaps';
import { publishCapabilityMap } from '../scripts/publishCapabilityMap';

const PUBLISHED_FOR_TESTS: readonly { sector: string; version: number }[] = [{ sector: 'electricity_network', version: 4 }];

export default async function globalSetup(): Promise<void> {
  const supabase = createServiceRoleClient(loadEnv());
  await loadAllCapabilityMaps(supabase);
  for (const { sector, version } of PUBLISHED_FOR_TESTS) {
    const { data, error } = await supabase.from('capability_maps').select('status').eq('sector', sector).eq('version', version).maybeSingle();
    if (error) throw new Error(`globalSetup: reading ${sector} v${String(version)}: ${error.message}`);
    if ((data as { status: string } | null)?.status === 'draft') await publishCapabilityMap(supabase, sector, version);
  }
}
