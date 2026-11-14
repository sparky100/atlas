# AI change drafting

Start in Changes or from a system. An organisation that enables its AI assistant can give Atlas a short brief about a future change. Atlas uses the current main model as context and produces Capture candidates for the user to review. This is the separately approved follow-on in ADR-028.

1. Add a change brief as a distinct Capture input. Reuse the upload, progress, retry and review workflow. Require contributor access and the organisation AI setting before generation.
2. Pass bounded model context alongside the brief. Generate candidates for explicit system additions or updates and additions of integrations or capability support. Ground each proposal in a quoted passage. Keep uncertain matches visible in the existing review, and leave unspecified dates, owners, removals and wider transitions for the author to resolve. New systems default to Planned. Relationship endpoints must match a single model element or new system in the brief.
3. Apply selected edits only to a Propose draft. Show the normal Change page for impact, conflicts and submission. Enforce the target intent in the database so alternate clients cannot apply a brief to a Record or Correct branch, or change the target intent after promotion.
4. Verify a new integration, phased CRM replacement and an explicit capability support addition. Check provenance, unresolved endpoints, feature gating and the Propose-only boundary.

The first version uses the Capture provider and matching stack. Decision options and drafting from an Ask Atlas conversation can follow once this workflow has been exercised.

## Starting-point pills

The Changes page offers common changes as pills (`src/ui/changes/changeBriefTemplates.ts`). Each fills a short brief whose blanks are picked from the model, so the drafting step is not guessing names. Each pill is written to be a complete change, using only edits the drafting prompt can produce:

- **Replace a system:** adds the new system as planned, adds a `replaces` link from the new system to the old one, sets the old system to retiring (and its planned end if a date is given). Applying the `replaces` edit moves the old system's capability support to the new system, the same step the JSON import's `replaced_by` already uses. Integrations and owners are not copied; the change page's impact panel shows what is left.
- **Introduce a new system:** a planned system supporting a named capability, as an "Also" system, with an optional go-live date.
- **Add an integration:** a `flows_to` link between two named systems.
- **Add a system to a capability:** an "Also" supports link. There is deliberately no "move a capability" pill, because moving means the old support stops, and drafting does not make removals.
- **Plan an end date:** sets a system's planned end.

`replaces` is accepted only from a change brief (`CHANGE_BRIEF_SCHEMA`); document extraction is unchanged. `pnpm ai:eval` has not been run against these prompt changes.

## Atlas MCP

Atlas MCP currently exposes read-only model tools. An MCP client can use them to research a brief, then hand the brief to Atlas's Draft with AI form. The existing Changes tools can list a promoted draft Change and report its impact. Capture drafts themselves stay in Atlas's review UI.

If Atlas later adds an MCP tool for submitting a brief, it should call the same Capture workflow with the caller's access and the organisation's AI setting. Return a review link and status. The user accepts edits in Atlas and applies them to a Propose draft through the same review workflow.
