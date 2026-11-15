# ADR-033 — Sample models

Status: accepted (Simon, 2026-11-15: "Offer a copy on join — let's do this"; offer both samples; show the offer only on an empty model list; include the capability map).

## Decision

A person who joins and has an empty model list is offered **"Start with a sample model"**: Northbridge DNO (electricity network) and Meridian retail. Adding one creates a separate, independent model in **their own organisation**, as one ordinary `manual` commit titled "Copied from the <name> sample". They can edit or delete it. Nothing is seeded automatically and no organisation can see another's data.

The offer shows only to someone who can create a model (owner or architect) and only while the organisation has no active model. It is not offered later from the model list.

## Where the sample content lives

Sample content is **versioned, product-owned data**, not application code (rule 7, ADR-012): the `sample_models` table, no `org_id`, readable by every signed-in user, writable only by a platform admin. A platform admin publishes any model they can read from **Model settings → Publish as a sample model**. Each publish is a new version; earlier versions are kept, and the newest is the one offered. People who already added a sample keep their own copy.

Because a sample is published from a real model, it carries the capability elements and every fact's original source, reference, date and confidence (rule 4). The payload is scrubbed on publish: a fact's `asserted_by` becomes the nil id, a source's `uri` becomes null, and it names no capture job or person.

## How a copy works, and why there is no new database function

`src/engine/sampleModel.ts` builds the payload from a head (`buildSamplePayload`) and plans the copy (`planSampleCopy`), reusing `buildCopyPlan` from ADR-030. `src/db/sampleModels.ts` then uses four existing paths, each under the caller's own row-level security: create the model (`models_insert`: owner or architect), insert its sources (`sources_insert`), commit the deltas to main (`atlas.commit_deltas`, which checks the caller's role itself), and insert its aliases (`aliases_insert`). Publishing is a plain insert guarded by `sample_models_insert`.

A new `SECURITY DEFINER` function callable by signed-in users would add a Supabase advisor warning (`authenticated_security_definer_function_executable`), which rule 9 does not allow. So there is none. The cost is stated plainly:

- **Not one transaction.** The model, sources, commit and aliases are separate calls. A failure after the model exists leaves it partly filled; the message says so and the owner can delete it in its settings.
- **The capability map link is not kept.** Row-level security does not let a person insert a `template` source, so a sample's capability-map source becomes a plain `document` source with the same name. The capability elements and their provenance text are there; the link to the map row, and the map's `template_code` aliases (hidden in the app), are not.

Ids come from the injected minter, never `Math.random` (rule 6).

## Access, stated plainly

This adds one new read: any signed-in user can read published sample content (made-up demo data, by choice of the platform admin who publishes it). It adds no cross-organisation read of customer data, no signed-out access, and no function. The boundary tests are in `src/db/sampleModels.integration.test.ts`: a non-admin cannot insert, a platform admin cannot publish in someone else's name or change or remove a version, a signed-out caller reads nothing, and a contributor and a signed-in user from a different organisation cannot copy into an organisation.

## Not included

Seeding every new organisation automatically; signed-out viewing (still a separate, held decision); refreshing a copy when a sample is updated (a copy is a one-off snapshot); reports and dashboards (version 1 of a sample carries the model only).

## Deferred

Offering a sample later from the model list; copying a sample's reports and dashboards; an all-or-nothing copy (needs a function, and so an advisor decision from Simon).
