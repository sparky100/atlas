/**
 * The `{{SCHEMA}}` block substituted into `docs/import/PROMPT.md` at
 * download time (`downloadImportPrompt.ts`), for a capture run's JSON
 * input format (SPEC-capture.md §5.6).
 * Field names are pulled from `IMPORT_COLUMNS`/`RELATIONSHIP_IMPORT_COLUMNS`/
 * `CHANGE_IMPORT_COLUMNS` (never hand-retyped, so they can't drift from the
 * real importer); the explanatory rules alongside them are this module's own
 * prose, describing behaviour those constants can't speak to themselves (the
 * platform/module rule, the owner syntax, matching, `replaced_by`).
 *
 * Describes the JSON shape `parseImportJson.ts` actually parses —
 * `{ systems, relationships, changes }`, `quote`/`confidence` as optional
 * fields on each individual entry (not `IMPORT_COLUMNS`-listed columns:
 * they're per-entry provenance metadata, not element/relationship
 * attributes, so they're documented here directly rather than folded into
 * those column lists). Pure — no I/O, no capability data; the model-specific
 * half of the prompt is `{{CAPABILITY_LIST}}`, built elsewhere.
 */
import { INTERFACE_TYPE_OPTIONS } from '../contracts/attributeSchema';
import { INTEGRATION_PROTOCOL_OPTIONS } from '../contracts/relationshipAttributeSchema';
import { IMPORT_COLUMNS } from './importRowSchema';
import { RELATIONSHIP_IMPORT_COLUMNS } from './importRelationshipRow';
import { CHANGE_IMPORT_COLUMNS } from './importChangeRow';

export function buildImportPromptSchema(): string {
  return `The import file is a single JSON file with three top-level arrays — \`systems\`, \`relationships\`, and \`changes\`. Every entry in each may also carry \`quote\` and \`confidence\`, described at the end.

### \`systems\` — one entry per system or module

Fields (only what's actually known has to be filled in): \`${IMPORT_COLUMNS.join(', ')}\`

- \`name\` is the only field that's always required.
- \`platform\` decides structure: leave it out for a top-level system. Set it to an existing platform's name (e.g. "SAP") to make this entry one of that platform's own modules instead.
- When \`platform\` is set, \`name\` is the module's own bare name only (e.g. "PM") — never prefixed with the platform (never "SAP · PM"). "Platform · Module" is only for *referencing* a module elsewhere (\`relationships\`' \`from\`/\`to\`/\`via\`, \`changes\`' \`name\`/\`replaced_by\`), never for naming one here.
- \`kind\` is one of: application, integration_platform, data_platform, infrastructure, platform. Only meaningful for a top-level system (no \`platform\`) — leave it out on a module.
- \`lifecycle\` is one of: planned, active, retiring, retired.
- \`criticality\` is one of: critical, high, medium, low.
- \`annual_run_cost\` is one of: none_included, under_50k, 50k_250k, 250k_1m, 1m_5m, over_5m — a banded judgement of the avoidable annual run cost of this system or module ("None / included" … "Over £5m"). Leave it out if it isn't known; never guess, and never set it for a capability (it isn't a field there).
- \`disposition\` is one of: tolerate, invest, migrate, eliminate — the TIME decision recorded for this system or module, when the source states one. Leave it out if it isn't stated; never infer it from other facts, and never set it for a capability.
- \`domain\` is one of: it, ot, hybrid.
- \`hosting_model\` is one of: on_premises, private_cloud, public_cloud, saas, hybrid.
- \`vendor\` is free text. Only meaningful for a top-level system — leave it out on a module.
- \`is_external\` is true/false.
- \`external_organisation\` is free text (e.g. "Acme Consulting") — only meaningful for a top-level system.
- \`capability\` names one or more capabilities from the list below, separated by \`|\` if there's more than one — the first one listed becomes the primary link, any others are secondary. Leave it out if nothing fits; never invent a capability name.
- \`interface_type\` is one of: ${INTERFACE_TYPE_OPTIONS.join(', ')} — only for a module of an integration platform (an *interface*: an API, file drop, topic or job the platform exposes or consumes). Leave it out everywhere else.
- \`transformation\` is free text: what the platform does to the data on this interface (maps, enriches, combines, converts a file to an API…). Only for an interface.
- \`business_owner\`/\`technical_owner\` each name one person, team, or organisation. A plain name ("Jane Doe") creates or matches an ordinary owner. "Name (External: Org)" (e.g. "Ofgem (External: Energy regulator)") creates or matches an external organisation instead.

An entry that matches an existing system or module by name updates it; a name that doesn't match anything creates a new one.

### \`relationships\` (optional) — one entry per connection between two systems

Fields: \`${RELATIONSHIP_IMPORT_COLUMNS.join(', ')}\`

- \`from\`/\`to\` each name an existing or newly-described system or module, by its \`name\` from \`systems\`. To point at a module specifically (rather than a top-level system of the same name), write "Platform · Module" (e.g. "SAP · PM").
- \`type\` is \`uses\` or \`flows_to\`.
- \`description\` is the verb phrase (e.g. "sends payment confirmations to") — always required.
- \`via\` optionally names an integration platform (a system with \`kind = integration_platform\`) this connection actually routes through, or one of its interfaces as "Platform · Interface". Leave it out for a direct connection.
- \`protocol_in\`/\`protocol_out\` are each one of: ${INTEGRATION_PROTOCOL_OPTIONS.join(', ')} — how data reaches the platform from \`from\`, and how it leaves the platform to \`to\` (e.g. file_sftp in, rest_api out). Only with \`via\`.
- \`data_classification\` is one of: public, official, official_sensitive, special_category — only meaningful for a \`flows_to\` entry, never a \`uses\` entry.

### \`changes\` (optional) — explicit retire/restore of an existing system or module

Fields: \`${CHANGE_IMPORT_COLUMNS.join(', ')}\`

- \`name\` names an existing system or module — a \`changes\` entry never creates anything itself, but it can name one this same import's own \`systems\` array is introducing for the first time (a full inventory commonly creates something only to record, in the same file, that it's already being retired or replaced). "Platform · Module" works here too.
- \`action\` is \`retire\` or \`restore\`.
- \`replaced_by\` (retire only) names the system or module taking over — same rule as \`name\`, so it can also be something this same import is introducing. Every one of the retiring element's own *already-existing* capability links transfers to it; a capability this same \`systems\` entry just linked for the first time does not (there's nothing to transfer yet) — put the \`capability\` field on the replacement instead if that's what's meant.
- \`reason\` is free text explaining why, shown to whoever reviews the import.

Use \`changes\` only when you're told something is being decommissioned or reinstated on purpose — never guess that something no longer exists just because nobody mentioned it.

Value streams and their stages are never part of this file — they're edited directly on the model, not imported.

### \`quote\`/\`confidence\` — on every \`systems\`, \`relationships\`, and \`changes\` entry

Always include both, on every \`systems\`, \`relationships\`, and \`changes\` entry you produce:

- \`quote\`: the exact sentence or phrase from what you were given that this entry is based on.
- \`confidence\`: a number from 0 to 1 for how sure you are this entry is correct.

Never state something as fact with high confidence if the source material only implied or guessed at it.
`;
}
