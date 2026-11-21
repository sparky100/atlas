/**
 * `pnpm content:publish-catalogue --sector electricity_network --version 1`
 * — D3 PR 2. Moves a loaded draft catalogue to published.
 *
 * Run `pnpm content:review-catalogue` first: the reviewer list and the
 * pinned-map name/code checks are script-side, while the database guard
 * enforces the hard rules (published map version, higher version number,
 * 1–8 claims, 1–10 capability links, exact code/name matches, snapshot
 * size). Publishing is refused if any of those fail, and the error is the
 * database's own.
 */
import { createServiceRoleClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { isCliEntrypoint } from './isCliEntrypoint';

function arg(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sector = arg(args, '--sector');
  const version = Number(arg(args, '--version'));
  if (!sector || !Number.isInteger(version) || version < 1) {
    console.error('Usage: pnpm content:publish-catalogue --sector <sector> --version <n>');
    process.exitCode = 1;
    return;
  }
  const supabase = createServiceRoleClient(loadEnv());
  const { data, error } = await supabase.from('product_catalogues').select('id, status').eq('sector', sector).eq('version', version).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data;
  if (!row) {
    console.error(`No ${sector} v${String(version)} catalogue is loaded. Run content:load-catalogue first.`);
    process.exitCode = 1;
    return;
  }
  if (row.status === 'published') {
    console.log(`${sector} v${String(version)} is already published.`);
    return;
  }
  const { error: publishError } = await supabase.from('product_catalogues').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', row.id);
  if (publishError) throw new Error(`Publish refused: ${publishError.message}`);
  console.log(`${sector} v${String(version)} published.`);
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
