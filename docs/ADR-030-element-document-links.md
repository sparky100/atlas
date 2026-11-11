# ADR-030 — Document links on elements

**Status:** Accepted (Simon, 2026-11-10: "A").
**Depends on:** ADR-000 (Atlas stores no documents), ADR-013/ADR-024 (`evidence` pattern), ADR-009 (RLS).

## Decision

Every element can carry several labelled **document links**: a label ("Solution design") and a pointer to where the document lives — either an http(s) link (Confluence, SharePoint, a shared drive) or a plain reference such as "SharePoint › Business cases". Atlas stores the label and the pointer, never the document.

- **Table `element_links`** (`supabase/migrations/20261110010000_element_links.sql`), workflow tier alongside `evidence` and `project_links`: never a delta, never folded into a head, never in a version. `kind` is `link` iff the pointer is http(s) (a check constraint); anything else is a `reference`. Other schemes (`javascript:`, `ftp:`, `file:`) are refused by `validateElementLink` (`src/contracts/elementLink.ts`).
- **Who can edit:** Owners and Architects add, edit and remove directly (RLS). Every organisation member can read. Contributors and Viewers cannot write; a Contributor who has a document to add says so in a comment on the item.
- **Provenance:** each row keeps who added it and when, and who last edited it and when.
- **The element must exist** in the link's model, checked against permanent `element_create` history (`atlas.check_element_link`), like comment anchors.

## Accepted risk

Editing or removing a document link is **not** in History: the row is updated or deleted in place, and only the latest label, pointer and who/when survive. This is reference material, not an architecture fact; routing it through deltas would need a list-valued attribute type and a change just to fix a broken link (option B, declined). A link to a retired element stays on the row.

## Not done

No document storage or upload, no link checking, no importer support, no Contributor direct edit.
