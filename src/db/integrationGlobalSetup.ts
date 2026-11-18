import { assertLocalTestEnvironment } from './assertLocalSupabase';

// Runs once before any integration test: refuse a non-local Supabase (see assertLocalSupabase.ts).
export default function setup(): void {
  assertLocalTestEnvironment();
}
