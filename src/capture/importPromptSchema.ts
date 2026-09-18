/**
 * Import close-out — the `{{SCHEMA}}` block substituted into
 * `docs/import/PROMPT.md` at download time (`downloadImportPrompt.ts`).
 * Column names themselves are pulled from `IMPORT_COLUMNS`/
 * `RELATIONSHIP_IMPORT_COLUMNS` (never hand-retyped, so they can't drift
 * from the real importer); the explanatory rules alongside them are this
 * module's own prose, describing behaviour those two constants can't speak
 * to themselves (the platform/module rule, the owner syntax, matching).
 * Pure — no I/O, no capability data; the model-specific half of the prompt
 * is `{{CAPABILITY_LIST}}`, built elsewhere.
 */
import { IMPORT_COLUMNS } from './importRowSchema';
import { RELATIONSHIP_IMPORT_COLUMNS } from './importRelationshipRow';

export function buildImportPromptSchema(): string {
  return `### Systems sheet — one row per system or module

Columns (in any order; a row only needs to fill in what it actually knows): \`${IMPORT_COLUMNS.join(', ')}\`

- \`name\` is the only column that's always required.
- \`platform\` decides structure: leave it blank for a top-level system. Fill it with an existing platform's name (e.g. "SAP") to make this row one of that platform's own modules instead.
- \`kind\` is one of: application, integration_platform, data_platform, infrastructure, platform. Only meaningful for a top-level system (blank \`platform\`) — leave it blank on a module row.
- \`lifecycle\` is one of: planned, active, retiring, retired.
- \`criticality\` is one of: critical, high, medium, low.
- \`domain\` is one of: it, ot, hybrid.
- \`hosting_model\` is one of: on_premises, private_cloud, public_cloud, saas, hybrid.
- \`vendor\` is free text. Only meaningful for a top-level system — leave it blank on a module row.
- \`is_external\` is true/false (yes/no also accepted).
- \`external_organisation\` is free text (e.g. "Acme Consulting") — only meaningful for a top-level system.
- \`capability\` names one or more capabilities from the list below, separated by \`|\` if there's more than one — the first one listed becomes the primary link, any others are secondary. Leave blank if nothing fits; never invent a capability name.
- \`business_owner\`/\`technical_owner\` each name one person, team, or organisation. Plain text ("Jane Doe") creates or matches an ordinary owner. "Name (External: Org)" (e.g. "Ofgem (External: Energy regulator)") creates or matches an external organisation instead.

A row that matches an existing system or module by name updates it; a name that doesn't match anything creates a new one.

### Relationships sheet (optional) — one row per connection between two systems

Columns: \`${RELATIONSHIP_IMPORT_COLUMNS.join(', ')}\`

- \`from\`/\`to\` each name an existing or newly-described system or module, by its \`name\` from the Systems sheet. To point at a module specifically (rather than a top-level system of the same name), write "Platform · Module" (e.g. "SAP · PM").
- \`type\` is \`uses\` or \`flows_to\`.
- \`description\` is the verb phrase (e.g. "sends payment confirmations to") — always required.
- \`via\` optionally names an integration platform (a system with \`kind = integration_platform\`) this connection actually routes through. Leave blank for a direct connection.
- \`data_classification\` is one of: public, official, official_sensitive, special_category — only meaningful for a \`flows_to\` row, never a \`uses\` row.
`;
}
