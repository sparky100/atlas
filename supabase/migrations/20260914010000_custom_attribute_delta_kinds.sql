-- F1 ("custom attributes"): two new `delta_kind` values for an org-defined
-- attribute's own delta shape (`ElementUpdateCustom`/`RelationshipUpdateCustom`,
-- src/contracts/delta.ts) — deliberately separate from `element.update`/
-- `relationship.update` rather than widened into them (see that file's own
-- doc comment on `ElementUpdateCustom`): a custom attribute's key is runtime
-- org data, not one of the closed, compiler-checked core attribute keys, and
-- keeping the two kinds apart means a custom key that happens to collide
-- with a promoted column name (`name`/`parentId`) can never be mistaken for
-- one by the fold logic on either side (TypeScript or, from the next
-- migration on, SQL).
--
-- This migration only adds the two enum values. Postgres does not allow a
-- new enum label to be referenced by name in the same transaction that adds
-- it (ALTER TYPE ... ADD VALUE is only visible after commit) — hence this
-- trivial migration, split from the one that uses the new values by name,
-- same convention 20260913140000_preparation_commit_kind.sql already
-- established for 'preparation'.

alter type delta_kind add value if not exists 'element_update_custom';
alter type delta_kind add value if not exists 'relationship_update_custom';
