-- Sprint F1 step 6: lets a branch's own commits actually advance its head.
--
-- 20260906071400_history.sql deliberately left head_commit_id out of the
-- authenticated grant on branches, because nothing yet existed to check
-- that an advance was legitimate — allowing a raw update then would have
-- let a client point a branch at any commit at all. src/db's repository
-- layer (this step) is that "something": it performs a compare-and-swap
-- update (`WHERE head_commit_id = <the head the client last saw>`) for
-- optimistic concurrency (C13: a stale write loses, rather than silently
-- overwriting), and the trigger below is the integrity backstop that holds
-- even if a future caller skips the CAS and updates directly — the new
-- head must be a real commit whose parent is the branch's current head and
-- whose branch_id is this branch, not an arbitrary commit id.

create or replace function atlas.guard_branch_head_advance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.head_commit_id is not distinct from old.head_commit_id then
    return new;
  end if;
  if old.status <> 'draft' then
    raise exception 'head_commit_id can only advance while the branch is draft (S-18)' using errcode = '23514';
  end if;
  if not exists (
    select 1 from commits c
    where c.id = new.head_commit_id
      and c.branch_id = new.id
      and c.parent_commit_id is not distinct from old.head_commit_id
  ) then
    raise exception 'head_commit_id must advance to a commit on this branch whose parent is the branch''s current head' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger branches_guard_head_advance
  before update on branches
  for each row execute function atlas.guard_branch_head_advance();

grant update (head_commit_id) on branches to authenticated;
