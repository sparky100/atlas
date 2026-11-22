# Reference content reconciliation — first read-only pass

22 November 2026. This records the repository at `0bbb6bbe` and the read-only inventory command added in this branch. **The live database has not been queried from this workspace**: no server-side Supabase credentials are present here. The `--live` command below produces the missing comparison on an authorised machine. No map, catalogue, option, or organisation model was changed.

## Repository baseline

There are 29 map-version files for 17 sectors and 17 catalogue-version files containing 133 entries. All 17 catalogue files declare `draft`. The table shows the map version each catalogue pins, its status **in the repository**, and the number of product entries. It does not imply those versions have the same status in the app.

| Sector | Pinned map | Map file | Catalogue file | Entries |
|---|---:|---|---|---:|
| any_organisation | 2 | draft | v1 draft | 6 |
| electricity_network | 4 | draft | v1 draft | 19 |
| financial_services | 1 | published | v1 draft | 7 |
| fire_rescue | 1 | draft | v1 draft | 6 |
| hei | 2 | draft | v1 draft | 7 |
| housing | 2 | draft | v1 draft | 9 |
| local_government_england | 2 | draft | v1 draft | 7 |
| local_government_scotland | 2 | draft | v1 draft | 6 |
| manufacturing | 1 | draft | v1 draft | 7 |
| nhs | 2 | draft | v1 draft | 7 |
| police | 1 | draft | v1 draft | 8 |
| public_body | 2 | draft | v1 draft | 6 |
| rail_transport | 1 | draft | v1 draft | 8 |
| retail_ecommerce | 1 | draft | v1 draft | 7 |
| retail_energy | 1 | draft | v1 draft | 9 |
| utility | 3 | draft | v1 draft | 7 |
| water_wastewater | 1 | draft | v1 draft | 7 |

The previous plan said Any Organisation v2 was absent from the repository. That is now stale: `content/capability-maps/any_organisation/2.json` exists as a draft with 70 items and six value streams. The electricity-network map v4 file is also a draft with 84 items. Simon's live query reported electricity-network catalogue v1 as **published** with 19 entries on 21 November 2026. Simon confirmed on 22 November that the live database entries are correct. The live publication is the baseline; the draft label in the repository file is stale publication metadata, not evidence that live content should be withdrawn. The exact live content has not been queried from this workspace.

## Identity candidates, not automatic matches

The repository contains 15 vendor-and-product names in more than one sector: Blue Yonder Warehouse Management, Civica Revenues & Benefits, ArcGIS Utility Network, Granicus govService, IBM Maximo Application Suite, Idox Uniform, IFS Copperleaf, Dynamics 365 Customer Service, Dynamics 365 Field Service, Motorola Computer Aided Dispatch, NEC Revenues & Benefits, Oracle Primavera Unifier, Oracle Utilities Customer Cloud Service, Liquidlogic Adults Case Management, and Liquidlogic Children’s Case Management. The command reports each exact occurrence and its sector/version/code. These are **review candidates**; equal names do not establish that product editions, evidence or applicability are identical.

It also flags 79 repeated capability names across sectors, including repetitions in successive map versions. A human must decide which share one business meaning. Stable canonical IDs must not be assigned by this name match.

## Live comparison and interpretation

On a trusted server with `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in the process environment, run:

```bash
pnpm content:inventory --live > reference-inventory.json
```

The command performs only SELECTs. It pages reads, compares map items, map sources, value streams and enables links, and compares catalogue entries, support links and sourced claims. It reports live-only and repository-only sector/version keys, statuses, content differences, seeded-model counts per map, and saved option-citation counts per catalogue. It emits no organisation names, model names, user identities, reviewer names, or raw claims. The output should be reviewed privately because even counts and product names may be operationally sensitive. A missing or failed read stops the comparison; it does not silently treat a missing table as empty.

Use the live pass to record the authoritative published versions and their citations, and to find repository files that need reconciliation. A difference is a review item, not a reason to alter a correct live entry. Do not deprecate, withdraw or remap live content merely to match a file. Sample-model payloads are not read by this command; their embedded map lineage needs a separate inspection if cited versions cannot be established from `sources`.

## D1–D4 integration boundary

The current `find_catalogue_products` tool resolves a model capability's `templateRef` and then looks up the latest published sector catalogue through `createToolContext`. The Designer prompt and handler accept the resulting `{sector, version, entryCode}` refs; decisions save immutable `option_catalogue_sources` snapshots. D4 web research can depend on a catalogue miss. Those contracts and old citations must remain readable. This inventory changes none of them.

The independent next slice is canonical capability identity and the map-item bridge. The new product reader, Designer refs, option-source renderer and web fallback belong to a later integration slice after the concurrent D4 fixes have a stable interface. Do not deploy a half-mapped catalogue or merge duplicate products automatically.
