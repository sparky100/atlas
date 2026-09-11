-- M1 close-out item 1: "extend unresolved_comment_counts (or add
-- thread_counts) to return open and total per anchor so 'all resolved' is
-- distinguishable." `atlas.unresolved_comment_counts` only ever counted
-- open root threads, filtered before grouping — an anchor with zero open
-- threads is simply absent from its result either way, whether that's
-- because nothing was ever commented there or because every thread on it
-- has since been resolved. The landscape/capability-map marker's own
-- "hollow" (all-resolved) state needs to tell those two apart, and no
-- existing caller can, from this RPC's shape.
--
-- `atlas.thread_counts` replaces it outright (every current caller wants
-- both counts now, including the two new ones this sprint adds — the
-- capability map's own marker and the element browse table's unresolved
-- column) rather than living alongside it as a second, overlapping RPC.

drop function if exists atlas.unresolved_comment_counts(uuid, uuid[]);

create or replace function atlas.thread_counts(p_model_id uuid, p_anchor_ids uuid[])
returns table (anchor_id uuid, open_count integer, total_count integer)
language sql
stable
set search_path = public, pg_temp
as $$
  select c.anchor_id,
         count(*) filter (where c.status = 'open')::int as open_count,
         count(*)::int as total_count
  from comments c
  where c.model_id = p_model_id
    and c.anchor_id = any(p_anchor_ids)
    and c.parent_comment_id is null
  group by c.anchor_id;
$$;

revoke all on function atlas.thread_counts(uuid, uuid[]) from public;
grant execute on function atlas.thread_counts(uuid, uuid[]) to authenticated;
