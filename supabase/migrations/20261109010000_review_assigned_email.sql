-- Review-assigned email: a reviewer who is asked to review a change keeps
-- the in-app notification and also gets an email with a link to that review,
-- sent at the moment they are assigned (submit or reviewer-set change).
--
-- Two additions, no new table:
--   user_preferences.email_on_review_assigned — the reviewer's own opt-out
--     for the email (default on). Independent of notify_on_review_assigned,
--     which still gates the in-app notification.
--   notifications.emailed_at — set by the send-review-email edge function
--     (service role) once the email for that notification has gone out, so a
--     retry or a second call never emails the same person twice. Not
--     granted to authenticated: only the function writes it.

alter table user_preferences add column email_on_review_assigned boolean not null default true;

comment on column user_preferences.email_on_review_assigned is 'Whether being assigned as a reviewer also sends this user an email (in addition to the in-app notification). Read by the send-review-email edge function. Opting out never removes the review_verdicts row or the in-app notification — only the email.';

alter table notifications add column emailed_at timestamptz;

comment on column notifications.emailed_at is 'When the review-assignment email for this notification was sent (review_assigned only; null for every other kind and for not-yet-emailed rows). Written only by the send-review-email edge function with the service role.';
