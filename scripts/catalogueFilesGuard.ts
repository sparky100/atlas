/**
 * Catalogue maintenance step 3 (proposals/PROPOSAL-catalogue-maintenance.md):
 * the product files are no longer a source for the live project. The loader
 * and publish scripts write catalogue content with the service-role key, so
 * they now run only against a local Supabase, for tests. Product changes are
 * made in Platform admin > Products. There is deliberately no override.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);

export function assertCatalogueFilesAllowed(supabaseUrl: string): void {
  let host = '';
  try { host = new URL(supabaseUrl).hostname; } catch { host = ''; }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      'Catalogue content is maintained in the app (Platform admin > Products), not from files. ' +
        'This script now runs only against a local Supabase, for tests.',
    );
  }
}
