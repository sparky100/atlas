-- Sprint M1b (docs/HANDOFF-M1b-comments.md's own "Backend work this design
-- requires"): a reply with no @handle in it currently notifies nobody —
-- `notification_kind` has exactly one value, 'mention'. This migration
-- only adds the enum value. Postgres does not allow a new enum label to be
-- referenced by name in the same transaction that adds it (ALTER TYPE ...
-- ADD VALUE is visible only after the transaction commits) — hence this
-- trivial migration, split from the one that uses 'reply' as a real
-- notification kind (20260906350000_comment_reply_notifications.sql), the
-- same split ADR-018's 'genesis' commit_kind value already established
-- (20260906210000_commit_kind_genesis.sql).

alter type notification_kind add value 'reply';
