-- S1 item 4 (docs/prompts/atlas-prompt-pack.md): "Cancel a change: proposer
-- or owner/architect, Draft or Proposed; status cancelled." This migration
-- only adds the enum value. Postgres does not allow a new enum label to be
-- referenced by name in the same transaction that adds it (ALTER TYPE ...
-- ADD VALUE is visible only after the transaction commits) — hence this
-- trivial migration, split from the one that uses 'cancelled' as a real
-- status (20260912111000_cancel_change_function.sql), the same split
-- 'reply'/'genesis' each already established
-- (20260906340000_notification_kind_reply.sql,
-- 20260906210000_commit_kind_genesis.sql).

alter type branch_status add value 'cancelled';
