-- F3a: the notification kind for a review assignment. Trivial on purpose —
-- a new enum label cannot be referenced by name in the same transaction
-- that adds it (Postgres), so this is split from 20260914080000_review_verdict_rpcs.sql
-- which actually writes a `'review_assigned'` notification, the same split
-- 20260906340000_notification_kind_reply.sql already established for
-- `'reply'`.

alter type notification_kind add value 'review_assigned';
