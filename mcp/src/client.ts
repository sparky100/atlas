/**
 * ADR-029 §2: the Supabase client this server reads with — the public URL
 * and anon key plus the user's own saved session, so row-level security is
 * the only authorisation. No timer refreshes the token in the background
 * (it would keep a short-lived command like `login` from exiting); an
 * expired session is refreshed when it is next read, which is when a tool
 * runs.
 */
import { createClient } from '@supabase/supabase-js';
import type { Client } from '../../src/db/client';
import type { McpSettings } from './config';
import { createFileStorage } from './sessionStore';

export function createAtlasClient(settings: Pick<McpSettings, 'url' | 'anonKey' | 'configDir'>): Client {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- same untyped-client boundary src/db/client.ts documents.
  return createClient(settings.url, settings.anonKey, {
    auth: { storage: createFileStorage(settings.configDir), persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
