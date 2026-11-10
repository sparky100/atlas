# ADR-030 — Copy a model (owner only)

Status: accepted (Simon, 2026-11-10: "yes to all"; copying into another organisation is for another day).

## Decision

An organisation **owner** can copy a model into a new, independent model **in the same organisation**, from *Model settings → Copy this model*.

**Copied** (the model as it stands on main today):
- every live element and relationship, under new ids, with attributes;
- each fact's original provenance — source, source reference, effective date, confidence — with the model's `sources` re-keyed into the new model (SPEC §4; rule 4). The copy's facts are "asserted by" the owner who copied, at the time of copying;
- aliases (names, codes, external refs, merged ids), re-pointed at the new element ids;
- organisation-visible saved reports and dashboards (their tiles included). A report spec holds no element ids.

**Not copied:** version history (the copy starts with one `manual` commit titled "Copied from <name>"), tags, open changes, decisions, assumptions, evidence (it exists to support decisions), projects, comments, review queues and verdicts, report snapshots, private reports and dashboards (they belong to a person), cross-organisation shares, saved layouts (hints; ADR-011). Membership belongs to the organisation, so the same people and roles apply.

## How

`src/engine/copyModel.ts` (pure) builds the deltas from the source head: an `element.create` per element carrying its `$exists` fact's provenance, plus an `update`/`update_custom` delta for any fact whose provenance differs from it, then `relationship.create` (and updates) with `via` re-pointed. `src/db/copyModel.ts` reads the head, folds the deltas through the real engine to get the projection and head hash, and calls `atlas.copy_model` (`20261110010000_copy_model.sql`), which in one transaction checks `has_role(org, 'owner')`, checks main has not moved since the head was read, creates the model (the existing trigger gives it genesis and main), the sources, the commit, deltas, head projection, aliases, reports and dashboards. The source model is only read. Nothing in `deltas`/`commits`/... is updated or deleted (rule 5).

## Why a new single commit rather than replaying history

Replaying thousands of historical commits under new ids would need every historical delta, merge and resolution remapped; the demo and "start from a good state" use cases need the current state only.

## Deferred

Copying into a different organisation (needs a decision on custom attribute definitions, member roles, and capability-map access).
