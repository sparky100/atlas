-- Sprint F7 item 3: notification preferences (mentions, replies only —
-- "assigned reviews" has no notification_kind of its own yet, since F3a's
-- review-verdict mechanism was never built; nothing to gate there, and
-- nothing built to fake). Two nullable-by-default-true booleans, same
-- per-column-default convention this table already uses for
-- home_mode/density/theme, rather than a jsonb blob or a second table.

alter table user_preferences add column notify_on_mention boolean not null default true;
alter table user_preferences add column notify_on_reply boolean not null default true;

comment on column user_preferences.notify_on_mention is 'Sprint F7 item 3: whether an @mention creates a notifications row for this user. Checked by atlas.process_comment_mentions (redefined below) at the moment a notification would otherwise be written — an opted-out mention still creates its comment_mentions row (the factual "who was mentioned" record @mention resolution and rendering both depend on), only the notification itself is skipped.';
comment on column user_preferences.notify_on_reply is 'Sprint F7 item 3: same as notify_on_mention, for a reply-to-a-thread notification.';

-- Redefines atlas.process_comment_mentions (most recently
-- 20260906350000_comment_reply_notifications.sql) to check each
-- recipient's own preference immediately before the one line that writes
-- their notification — everything else (the @mention regex parse, the
-- comment_mentions record, the reply-participant loop, the
-- mention-wins-over-reply de-duplication) is unchanged, copied verbatim.
-- coalesce(..., true) is the "no user_preferences row exists yet" default
-- (SPEC §3.2: "the row is created on first change, not on sign-up") — the
-- overwhelming majority of users, matching every column's own existing
-- unset-means-default behaviour.
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
      if coalesce((select notify_on_mention from user_preferences where user_id = v_user_id), true) then
        insert into notifications (id, org_id, user_id, kind, comment_id)
          values (gen_random_uuid(), new.org_id, v_user_id, 'mention', new.id);
      end if;
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
        if coalesce((select notify_on_reply from user_preferences where user_id = v_user_id), true) then
          insert into notifications (id, org_id, user_id, kind, comment_id)
            values (gen_random_uuid(), new.org_id, v_user_id, 'reply', new.id);
        end if;
      end if;
    end loop;
  end if;

  return new;
end;
$$;
