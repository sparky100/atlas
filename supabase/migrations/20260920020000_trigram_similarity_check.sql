-- F2 (full K1) PR2, K-9/P-K2: a thin wrapper around pg_trgm's own
-- `similarity()`, used only by `src/capture/trigram.integration.test.ts`
-- to check `src/engine/trigram.ts`'s pure-TypeScript reimplementation
-- against the real Postgres function it's meant to match exactly — never
-- called from application code, which always uses the TypeScript version
-- (K-9: matching must be reproducible with no database, SPEC-capture.md's
-- own `pnpm test`-with-no-database rule for the fixture harness, §12.4).

create or replace function atlas.trigram_similarity(p_a text, p_b text)
returns real
language sql immutable
set search_path = public, pg_temp
as $$
  select similarity(lower(p_a), lower(p_b));
$$;

revoke all on function atlas.trigram_similarity(text, text) from public;
grant execute on function atlas.trigram_similarity(text, text) to authenticated;
