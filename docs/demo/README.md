# Demo organisations

Two fictional organisations for demonstrating dashboards, Ask Atlas and the MCP server. They are ordinary import files for Atlas's own capture importer — no seed code, no migration, nothing reachable from a production code path. Every entry carries `quote` and `confidence`, so every fact has provenance.

| File | Organisation | Capability map |
| --- | --- | --- |
| `northbridge-dno.import.json` | Northbridge Power Distribution (a UK electricity DNO) | `electricity_network` v4 |
| `meridian-retail.import.json` | Meridian Energy Supply (a UK retail energy supplier) | `retail_energy` v1 (new, draft) |

Both are fictional. Vendor names are real products used for realism; the architectures, owners and gaps are invented.

## What each model contains

- **Northbridge:** SAP S/4HANA (finance, procurement, plant maintenance, project system, HCM, IS-U billing), Salesforce (service, experience, field service, flow, PSR), Esri ArcGIS, Autodesk (BIM), the DUoS billing, MPRS, UoS charging and DTN regulatory systems, an MDM plus DCC integration, ADMS/SCADA/DERMS, MuleSoft Anypoint with eight interfaces, and external interfaces to MHHS, DCC, DTN, ECOES, Ofgem and NESO.
- **Meridian:** Salesforce, Kraken billing (replacing Junifer), Itron MDM, DCC adapter, ETRM, settlement (BSC today, MHHS planned), switching gateway, MuleSoft Anypoint with eight interfaces, and external interfaces to MHHS, DCC, DTN, ECOES, Elexon, Ofgem, Xoserve, DNO portals and comparison sites.
- **Deliberate gaps** so health findings and Ask Atlas have something to say: a system with no business or technical owner, a critical system that is retiring with no replacement, retiring systems whose replacements are not yet live, and planned systems with no flows yet.

## Loading

1. A platform admin loads the retail map (it is new and `draft`): `pnpm content:load-capability-maps` (needs the service role), then publishes it as for any map (`pnpm content:publish-capability-map`).
2. In the app, create an organisation and model per file, choosing the matching capability map.
3. Run a capture on the model with the file as input (Capture → JSON). Review the queue, then apply.

The importer is idempotent by name: re-importing updates rather than duplicates.

The tests in `src/capture/demoImports.test.ts` check each file parses cleanly and names only capabilities that exist in its map.

## Roadmap dates

Both files carry `introduced`, `planned_end` and `support_ends_at` (ISO `YYYY-MM-DD`) on top-level systems, so the Roadmap has bars to show: active systems have an introduced year, retiring systems end in 2027–2028 (some lose vendor support earlier), planned systems start in 2027–2028 and retired systems ended in 2025. Dates are illustrative. To add them to an org you already loaded, import the file again into the same model: matched systems are updated by name and the dates are the only changes. `support_ends_at` is for systems only; a module row that sets it is rejected.

## Network planning, connections and OT (Northbridge)

Northbridge also carries network planning and design tools (PowerFactory, scenario forecasting, investment planning), customer connections tools (quotation engine, public capacity map, generation connections register) and an OT layer (protection settings, substation automation, operational telecoms, historian, OT security monitoring). Re-import the file into the same model to add them; existing systems are matched by name and left as they are apart from their dates.
