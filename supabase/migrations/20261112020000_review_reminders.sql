-- Review reminders: an organisation-wide review period, and a record of the
-- one reminder email sent for an overdue review.
--
--   organisations.review_period_days — how many calendar days a reviewer has
--     to respond once a change is submitted (default 5). A review is overdue
--     when it is still `pending` and created_at + this many days has passed.
--     Nothing stored per review: the due date is derived, so changing the
--     period re-dates every open review at once.
--   merge_requests.reminded_at — set by the send-review-email edge function
--     (service role) when it sends the reminder, so a review is reminded at
--     most once however often the button is pressed. Not writable by
--     authenticated, like the rest of merge_requests.
--
-- The period is set through atlas.set_review_period (owner or architect),
-- not a column grant: organisations_update is owner-only, and architects
-- are meant to be able to tune this one setting.

alter table organisations add column review_period_days int not null default 5 check (review_period_days between 1 and 90);

comment on column organisations.review_period_days is 'Calendar days a reviewer has to respond to a change review before it is flagged overdue (default 5, 1-90). Set only through atlas.set_review_period (owner/architect).';

alter table merge_requests add column reminded_at timestamptz;

comment on column merge_requests.reminded_at is 'When the one reminder email for this overdue review was sent (null = none sent). Written only by the send-review-email edge function with the service role.';

create or replace function atlas.set_review_period(p_org_id uuid, p_days int)
returns organisations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row organisations;
begin
  if not atlas.has_role(p_org_id, 'owner', 'architect') then
    raise exception 'Only an owner or architect can change the review period.' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'The review period must be between 1 and 90 days.' using errcode = '22023';
  end if;
  update organisations set review_period_days = p_days where id = p_org_id returning * into v_row;
  return v_row;
end;
$$;

revoke all on function atlas.set_review_period(uuid, int) from public;
grant execute on function atlas.set_review_period(uuid, int) to authenticated;
