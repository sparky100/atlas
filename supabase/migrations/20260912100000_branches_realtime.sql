-- Sticky ref close-out: "any transition that makes the branch non-editable
-- for the current user resets the active ref to main on every open tab
-- (realtime)." `branches` was never added to the `supabase_realtime`
-- publication — `commits`/`comments` were (20260906240000_comments.sql),
-- `branches` simply had no realtime consumer yet until now
-- (`src/ui/branches/useBranchStatusReset.ts` is the first). Same
-- idempotent existence-check shape that migration already established, so
-- this is safe to replay against a database where a later migration
-- already added it.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'branches') then
    alter publication supabase_realtime add table branches;
  end if;
end $$;
