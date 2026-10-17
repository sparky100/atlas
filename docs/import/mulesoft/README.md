# Importing from MuleSoft Anypoint

Atlas imports an Anypoint export as a **file**, not a live connection. You run a small script on your own machine, upload the file it writes, and review the result like any other capture run — nothing changes until you accept and apply it.

## Steps

1. In **Capture → New capture run**, choose the source **MuleSoft Anypoint**.
2. **Download the export script** (`mulesoft-export.mjs`; also in this folder).
3. Install [Node.js](https://nodejs.org) and the Anypoint CLI (`npm install -g anypoint-cli-v4`), and log the CLI in (`anypoint-cli-v4 conf username …`, then organisation). The script only needs read access to API Manager.
4. Run `node mulesoft-export.mjs --env Production` (repeat `--env` for more environments; `--out` names the file). It lists every API instance and each one's contracts and writes `mulesoft-export.json`. Only an allow-list of fields is copied — no secrets are read — but check the file before you upload it.
5. Choose the file in the dialog. Atlas shows what it contains and any warnings, then **Start capture run**.
6. Review the candidates as usual (accept, reject, apply to a change).

## What you get

| In Anypoint | In Atlas |
|---|---|
| The organisation | One `integration_platform` system (default name "MuleSoft Anypoint", vendor MuleSoft, SaaS) |
| Each API instance | An **interface** (`api`) module of that platform; named from the asset id (or instance label), a deprecated API is `retiring` |
| Each client application with an approved contract | A system (matched to an existing one by name where there is one) |
| An approved contract | A `uses` relationship from the application to the interface — or, when the API's backend host is mapped, a `flows_to` the backend element `via` the interface, with `protocol_in` REST API for an HTTP endpoint |

Revoked, rejected or pending contracts are skipped and counted. Owners, capabilities and costs are never filled in — Anypoint doesn't know them.

## Backend systems

An API's backend hostname (`endpointUri`) tells Atlas where the API forwards to, but a hostname is not an Atlas element, and Atlas will not guess. In the dialog, map each hostname to the Atlas system that provides it, one per line:

```
mprs.example.com = MPRS
```

To keep a hostname for every later import, open the backend system's element page and add it under **Add an external reference** (a pasted URL is reduced to its hostname). A system can have as many references as it has hostnames, and the dialog applies all of them automatically; a line typed in the box overrides a saved one for that upload. Saved references are model-wide and, like all aliases, cannot be removed, so check the hostname before adding it. A hostname can belong to only one element.

Mapped APIs produce `flows_to` the backend via the interface (shown on the platform's Context view); unmapped ones leave the consumer linked to the interface only, and the platform page shows that interface with no flows.

## Things to know

- **Matching is by name.** Client application names ("PM") are matched against your model's elements; check the review queue's confirmations. Naming Anypoint client applications after the Atlas element helps.
- **Similar API names merge.** The importer treats very similar names in one file ("Test" and "Test 2", "Customer API" and "Customer API v2") as one element. The dialog warns when it sees such a pair; split the merged card in the review queue.
- **What is stored.** The run stores the *converted* import JSON (named after your export file), so re-importing a later export diffs against it and shows what changed or disappeared.
- Source: `src/capture/adapters/mulesoft.ts` (conversion), `mulesoftUpload.ts` (dialog side), `docs/import/mulesoft/mulesoft-export.mjs` (script).
