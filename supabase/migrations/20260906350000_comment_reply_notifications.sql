-- Sprint M1b (docs/HANDOFF-M1b-comments.md, "Backend work this design
-- requires" — decided, not re-litigated: "Do replies notify? Yes, in
-- M1b."). Extends atlas.process_comment_mentions (20260906240000_comments.sql)
-- rather than adding a second `after insert on comments` trigger — it
-- already parses the body and writes `notifications` rows in the comment's
-- own transaction, and a mention/reply notification must exist together
-- with the comment or not at all. One trigger, two kinds.
--
-- Recipients: thread participants — the root's own author plus everyone
-- who has already replied to it (ADR-010's flat reply chain means
-- new.parent_comment_id, when set, always names the root directly, never
-- another reply) — excluding the replying author themselves, the same
-- self-skip the mention loop above it already uses. A root comment (no
-- parent) has no thread yet, so it triggers no reply notifications; that's
-- what @mentions are for on a brand-new thread.
--
-- De-duplication: a reply that also @mentions a participant produces one
-- notification, not two. Mention wins — it is the more specific signal —
-- enforced with a `not exists` against the rows this same function
-- statement already inserted earlier in this same trigger invocation
-- (visible here because it's the same transaction), not a second pass
-- reconciling two already-written rows.

create or replace function atlas.process_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_handle text;
  v_user_id uuid;
begin
  for v_handle in
    select distinct lower(m[1]) from regexp_matches(new.body, '@([a-zA-Z0-9_-]+)', 'g') as m
  loop
    select p.user_id into v_user_id
    from atlas.profiles p
    join members mem on mem.user_id = p.user_id and mem.org_id = new.org_id
    where p.handle = v_handle;

    if v_user_id is not null and v_user_id <> new.author_id then
      insert into comment_mentions (comment_id, org_id, user_id) values (new.id, new.org_id, v_user_id)
        on conflict do nothing;
      insert into notifications (id, org_id, user_id, kind, comment_id)
        values (gen_random_uuid(), new.org_id, v_user_id, 'mention', new.id);
    end if;
  end loop;

  if new.parent_comment_id is not null then
    for v_user_id in
      select distinct author_id
      from comments
      where (id = new.parent_comment_id or parent_comment_id = new.parent_comment_id)
        and author_id <> new.author_id
    loop
      if not exists (select 1 from notifications where comment_id = new.id and user_id = v_user_id and kind = 'mention') then
        insert into notifications (id, org_id, user_id, kind, comment_id)
          values (gen_random_uuid(), new.org_id, v_user_id, 'reply', new.id);
      end if;
    end loop;
  end if;

  return new;
end;
$$;
