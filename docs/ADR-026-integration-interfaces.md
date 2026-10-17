# ADR-026: Integration interfaces — what an integration platform actually exposes

**Status:** **Accepted 2026-10-16** — option (c), the hybrid, chosen by the human; all four points under "Decisions confirmed" agreed as proposed ("yes to all four").
**Depends on:** ADR-000's "Amended (Prompt 7k item 4, integration platforms)" (`SystemAttributes.kind`, `UsesAttributes.via`/`FlowsToAttributes.via`, invariant C18), ADR-001 (containers: a module of a platform is a `container` whose `parentId` is that system), ADR-024's change-impact amendment (an integration counts only its consuming side), SPEC §4 (the delta format), rule 1 of `CLAUDE.md`.

## Context

An integration today is one `uses` or `flows_to` relationship from A to B, with a verb phrase, and — for `flows_to` — a data classification and a single `protocol`. When it goes through an integration platform, `via` names that platform (a system with `kind: 'integration_platform'`), and the platform's Context view draws it as source → platform → target.

That is enough for "A talks to B through MuleSoft". It is not enough for what integration platforms are for:

- **Different technology each side.** A drops a file on SFTP; the platform exposes it to B as a REST API. There is one `protocol` per relationship, so one side is always unrecorded.
- **One interface, many consumers.** A single "Customer API" on the platform, called by five systems, is five unrelated flows that happen to share a `via`. Nothing says they use the *same* thing, so retiring or changing that API shows no shared impact.
- **Combining.** "The platform merges A's and B's data into one feed for C" is two flows, A→C and B→C, with nothing joining them.
- **Transformation.** There is nowhere to say what the platform does to the data.

## Options

- **(a) More attributes on the flow.** A protocol for each side and a free-text transformation note on the relationship. Small, but reuse and combining stay invisible.
- **(b) Interfaces as the endpoints.** An interface element, with flows A → interface → B as two relationships. Reuse, combining and transformation are natural, but every business-level "A talks to B" becomes two hops, and every view, the change-impact rules and import/export would have to see through interfaces.
- **(c) Hybrid.** Keep the single A→B flow as the business fact; let `via` name either the platform or a named *interface* on it; record each side's protocol on the flow.

## Decision

**(c).**

1. **An interface is a module of the integration platform.** A `container` whose parent is a system with `kind: 'integration_platform'` is an *interface* — the same parent/child shape as SAP · PM, so it already has a page, a Context view, "Platform · Module" naming everywhere, and import/export support. `ContainerAttributes` gains:
   - `interfaceType?: InterfaceType` — what kind of thing the platform exposes or consumes (list below). Only meaningful on an interface; an ordinary module never sets it, the same "optional, meaningless elsewhere" stance `ContainerAttributes` already takes for the module overrides.
   - `transformation?: string` — free text: what the platform does to the data (maps, enriches, combines, filters, converts file to API…). `description` stays what the interface *is*.
2. **`via` may name an interface.** `UsesAttributes.via`/`FlowsToAttributes.via` accept either a system with `kind: 'integration_platform'` (as today) or a container whose parent is one. **C18** widens accordingly: the referenced element must be live and be one of those two. Flows naming the platform itself stay valid; an interface is optional detail, never required.
3. **Each side's protocol on the flow.** `UsesAttributes`/`FlowsToAttributes` gain `protocolIn?` (source → platform) and `protocolOut?` (platform → target), from the list below. The existing `FlowsToAttributes.protocol` keeps its meaning for a direct flow; on a flow with `via`, a lone `protocol` reads as both sides. "File in, API out" is `protocolIn: 'file_sftp'`, `protocolOut: 'rest_api'`.
4. **Reuse and combining are read, not stored.** Several flows naming the same interface *is* the reuse; several sources into one interface feeding one target *is* the combining. The interface's own page lists "Flows via this interface" (the query the platform page already runs, filtered to the interface), and the platform's Context view groups its flows by interface.
5. **Nothing else changes shape.** Context, Landscape and change-impact keep working on the single A→B flow; the consuming-side rule (ADR-024 amendment) is untouched. An interface is a module of the platform, so editing or retiring it counts as touching the platform, like any module.

**No migration.** Attributes live in the delta/head JSON and C18 is an engine check (no SQL constraint refers to `integration_platform`), the same as the original `via` amendment. Rule 1's contract and round-trip test still apply: `src/contracts/delta.ts` (types), `attributeSchema.ts`/`relationshipAttributeSchema.ts` (fields and option lists), `src/engine/deltas.ts` (C18), and a round-trip test that writes and folds an interface, a flow via it with both protocols, and reads them back.

## Views and capture

- **Platform Context view:** flows grouped under their interface (an interface band inside the platform column); flows naming only the platform sit in an "unspecified" group. Flow numbers (#359) stay.
- **Interface page:** type, transformation, "Flows via this interface" with each side's protocol.
- **Relationship add/edit:** the existing "via an integration platform?" step offers the platform's interfaces too, and asks for each side's protocol when a via is set.
- **Export/import:** `Via` already writes and reads "Platform · Module", so an interface round-trips; the Relationships sheet gains `Protocol in` and `Protocol out`; the module sheet gains `Interface type` and `Transformation`. The real-database round-trip test grows to cover them.
- **Health finding:** an interface with nothing flowing via it (like the existing unused-platform finding).

## Out of scope

Orchestration logic — sequencing, conditional routing, retries, error queues. That belongs to the platform's own tooling; an architecture model records *what* connects to *what*, through *which* interface, carrying *which* data.

## Decisions confirmed (2026-10-16)

1. **Interface form:** a typed module of the platform (this ADR), rather than a new element type. A new type would mean a migration (element type enum, relationship rules) and new pages for little gain.
2. **`InterfaceType` list** — `api`, `file`, `event` (topic/queue), `batch` (scheduled job), `database` (view/replication), `ot_gateway` (OT protocol bridge), `other`.
3. **Protocol list** — fixed list with an escape hatch, so reports can count by it: `rest_api`, `soap`, `graphql`, `file_sftp`, `file_share`, `event_queue`, `database`, `email`, `iccp`, `dnp3`, `iec_61850`, `modbus`, `opc_ua`, `manual`, `other` (the OT protocols because this is a networks business).
4. **The existing single `protocol`** on `flows_to` stays as the direct-flow protocol (this ADR), rather than being migrated into `protocolIn`/`protocolOut`.

## As built

- **Contracts:** `InterfaceType`, `IntegrationProtocol`, `ContainerAttributes.interfaceType`/`transformation`, `UsesAttributes`/`FlowsToAttributes.protocolIn`/`protocolOut` (`src/contracts/delta.ts`); fields and option lists in `attributeSchema.ts` (both `hideWhenEmpty`) and `relationshipAttributeSchema.ts`.
- **C18** (`src/engine/deltas.ts`, `checkVia`): accepts a live integration platform, or a live container whose parent is one. Property tests in `deltas.property.test.ts`.
- **Views:** the element page of an integration platform lists its **Interfaces** and **Flows via this platform** (flows via any of its interfaces included); an interface's page lists **Flows via this interface**, each with its side protocols. The platform Context view draws an interface band per interface inside the hub (flows naming only the platform under a dashed "Via the platform" band); an interface's own Context view is the same diagram for its flows alone. The Landscape routes a flow via an interface through the interface's platform.
- **Add relationship:** the via stage searches platforms and interfaces, and offers optional Protocol in / Protocol out.
- **Export/import:** Relationships sheet `Protocol in`/`Protocol out`; an interface `Via` is always written "Platform · Interface"; the module sheet's `Interface type`/`Transformation` columns come from the schema and are read back (synonym roles `interfaceType`/`transformation`). The importer resolves a via to an interface by exact name, bare or qualified, never by trigram. JSON import: `interface_type`, `transformation`, `protocol_in`, `protocol_out`. Covered by `exportImportRoundTrip.integration.test.ts`.
- **Health:** "integration interfaces with nothing flowing via them" (`findUnusedIntegrationInterfaces`); the unused-platform finding counts flows via its interfaces.
- **Not built:** a protocol column for the direct-flow `protocol` on the Relationships sheet (unchanged from before), and editing `interfaceType`/`transformation` on the JSON import of a top-level system (refused by validation — an interface is always a module).
