# ADR-032: Live connectors (MuleSoft first)

**Status:** Proposed 2026-11-13; credential storage chosen by Simon the same day (Supabase Vault, per organisation). Moves to Accepted when the first PR merges.
**Depends on:** ADR-026 (interfaces), SPEC-capture.md §5.6 (the MuleSoft file import), ADR-009 and ADR-017 (tenancy), rules 4, 7 and 8 of `CLAUDE.md`.

## Context

The MuleSoft import is a file: a person runs a script and uploads what it wrote. Simon asked for a live connection as well, keeping the file path, and for a pattern that further connectors (ServiceNow was next in line) can reuse. The importer itself must not change.

## Decision

1. **A connector only fetches a file.** It signs in to another tool, reads it, and returns the exact file its import source already reads (for MuleSoft, the export file the script writes). Conversion, matching, review and apply are untouched. The Import dialog gains a "Fetch from MuleSoft" button when the organisation has a connection; the file chooser stays.
2. **Settings are per organisation**, in Organisation settings, "Connections". Owners save and remove; owners and architects read and test. Non-secret settings live in `org_connectors.config`; the client secret lives only in **Supabase Vault**, encrypted at rest, referenced by `secret_id` (not selectable by any client role). `atlas.save_connector` / `atlas.remove_connector` are owner-only; `atlas.connector_secret` and `atlas.record_connector_fetch` are service-role only.
3. **Where it runs: the `connector-fetch` edge function**, a thin shim over `src/connectors/handler.ts`. It is called with the user's own session; the connector row is read with that session, so row-level security (owner or architect) is the permission check. Only then does the service role read the one secret. The secret is never returned, logged, or put in an error message.
4. **Read-only toward the other tool.** For MuleSoft: one token request, then GETs only, copying the same field allow-lists as the export script.
5. **Reuse:** a new connector is a kind in `src/contracts/connectors.ts` and the `org_connectors.kind` check, a fetcher beside `src/connectors/mulesoft/`, an entry in `src/connectors/registry.ts`, and a settings form.
6. **Bounded:** a time budget (about 100 s), a cap per environment, small concurrency, retries for a busy server.
7. **A manual "Fetch" button, not a schedule.** A scheduled pull would need a stored service credential for a scheduler, the same open question as scheduled reminders; not built.

## Verification limits

The Anypoint endpoints and response shapes are from MuleSoft's public documentation and have not been run against a live tenant. The tests use canned responses built from those shapes, and say so. The first real run is for the owner to do with **Test connection**.

## Out of scope

Scheduled sync, per-environment credentials, ServiceNow (not built; ServiceNow services are deliberately not an Atlas concept), changes to the importer or the converter.

## Consequences

- One migration (`20261113060000_org_connectors.sql`, which also enables the Vault extension), one contract file, one edge function, one folder `src/connectors/`.
- A second function (after `api`) holds the service key; this one reads only the secret of a connector the caller's own session could read.
