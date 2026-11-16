/**
 * The blank import spreadsheet offered on the Import page: what the importer
 * reads, laid out as a workbook a person can fill in. Pure — no `xlsx`
 * import here (the writer is `src/ui/import/downloadImportTemplate.ts`),
 * the same split `elementExport.ts` / `elementExportXlsx.ts` use.
 *
 * It is a helper for the one import route, never a second route: the file
 * goes through the same upload, matching and review as any other
 * spreadsheet. Its column list is derived from the importer's own
 * (`IMPORT_COLUMNS`, `RELATIONSHIP_IMPORT_COLUMNS`), and every heading must
 * be one the synonym table already recognises (`importTemplate.test.ts`
 * enforces both), so a column added to the importer cannot be missing here
 * and none of these headings ever needs an AI guess.
 *
 * The example rows are labelled "EXAMPLE" in their name and the instructions
 * say to delete them. They exist only in the downloaded file, never in a
 * model (rule 7: no seeded data reachable from a production path).
 */
import { IMPORT_COLUMNS, type ImportColumn } from './importRowSchema';
import { RELATIONSHIP_IMPORT_COLUMNS } from './importRelationshipRow';

type RelationshipColumn = (typeof RELATIONSHIP_IMPORT_COLUMNS)[number];

export interface TemplateSheet {
  name: string;
  cells: string[][];
}

/** The heading the template writes for each systems column — the same words this product's own export writes. */
export const SYSTEM_COLUMN_HEADINGS: Readonly<Record<ImportColumn, string>> = {
  name: 'Name',
  description: 'Description',
  kind: 'Kind',
  lifecycle: 'Lifecycle',
  criticality: 'Criticality',
  annual_run_cost: 'Run cost',
  disposition: 'Disposition',
  domain: 'IT/OT domain',
  hosting_model: 'Hosting model',
  vendor: 'Vendor',
  is_external: 'Outside our organisation',
  external_organisation: 'External organisation',
  platform: 'Parent system',
  capability: 'Capability',
  business_owner: 'Business owner',
  technical_owner: 'Technical owner',
  interface_type: 'Interface type',
  transformation: 'Transformation',
  introduced: 'Introduced',
  planned_end: 'Planned end',
  support_ends_at: 'Vendor support ends',
};

/** The relationships sheet's headings: the importer reads these case-insensitively, spaced or with underscores. */
export const RELATIONSHIP_COLUMN_HEADINGS: Readonly<Record<RelationshipColumn, string>> = {
  from: 'From',
  type: 'Type',
  to: 'To',
  description: 'Description',
  via: 'Via',
  data_classification: 'Data classification',
  protocol_in: 'Protocol in',
  protocol_out: 'Protocol out',
};

const SYSTEM_EXAMPLES: readonly Partial<Record<ImportColumn, string>>[] = [
  { name: 'EXAMPLE Customer records', description: 'Where customer contact details and history are kept.', kind: 'application', lifecycle: 'active', criticality: 'high', hosting_model: 'saas', vendor: 'Example Supplier Ltd', is_external: 'yes', capability: 'Customer management', business_owner: 'Customer Services', technical_owner: 'IT Applications' },
  { name: 'EXAMPLE Message hub', description: 'Passes data between our systems.', kind: 'integration_platform', lifecycle: 'active', criticality: 'medium', hosting_model: 'public_cloud', business_owner: 'IT Applications' },
  { name: 'EXAMPLE Billing feed', description: 'The feed that sends invoices to the finance system.', platform: 'EXAMPLE Message hub', interface_type: 'api', lifecycle: 'planned', introduced: '2027-04-01' },
];

const RELATIONSHIP_EXAMPLES: readonly Partial<Record<RelationshipColumn, string>>[] = [
  { from: 'EXAMPLE Customer records', type: 'flows_to', to: 'EXAMPLE Billing feed', description: 'sends customer details to', via: 'EXAMPLE Message hub', data_classification: 'official' },
];

function headingRow<K extends string>(columns: readonly K[], headings: Readonly<Record<K, string>>): string[] {
  return columns.map((column) => headings[column]);
}

function exampleRows<K extends string>(columns: readonly K[], examples: readonly Partial<Record<K, string>>[]): string[][] {
  return examples.map((example) => columns.map((column) => example[column] ?? ''));
}

const INSTRUCTIONS: readonly string[] = [
  'Atlas import template',
  '',
  'How to use this file',
  '1. Fill in the Systems sheet, one row per system (or per module of a system). Only Name is required; leave anything you do not know blank.',
  '2. If you want to record how systems connect, add one row per connection on the Relationships sheet.',
  '3. Delete the three EXAMPLE rows on the Systems sheet and the one on the Relationships sheet before you upload.',
  '4. In Atlas, go to Import, choose New import, and upload this file. You review everything before it changes your model.',
  '',
  'Good to know',
  '- Keep the headings in row 1 exactly as they are. You can delete a column you do not need, and the order does not matter.',
  '- To make a row a module of a system, put that system\'s name in Parent system. Leave it blank for a top-level system.',
  '- A column that holds a fixed choice only accepts the values listed below. A value that does not match is ignored and shown to you in the review, never guessed.',
  '- Capability should name capabilities that already exist in your model. Separate more than one with |. The first becomes the main link.',
  '- Business owner and Technical owner take one person, team or organisation. For an outside body write: Name (External: Organisation).',
  '- Dates are written YYYY-MM-DD, for example 2027-04-01.',
  '- Outside our organisation: yes or no.',
  '',
  'Fixed choices',
  '- Kind: application, integration_platform, data_platform, infrastructure, platform',
  '- Lifecycle: planned, active, retiring, retired',
  '- Criticality: critical, high, medium, low',
  '- Run cost: none_included, under_50k, 50k_250k, 250k_1m, 1m_5m, over_5m',
  '- Disposition: tolerate, invest, migrate, eliminate',
  '- IT/OT domain: it, ot, hybrid',
  '- Hosting model: on_premises, private_cloud, public_cloud, saas, hybrid',
  '- Relationships, Type: uses or flows_to',
  '- Relationships, Data classification: public, official, official_sensitive, special_category (flows_to only)',
  '',
  'Relationships sheet',
  '- From and To name a system or module exactly as it is written on the Systems sheet or already in your model. For a module write: System · Module.',
  '- Description is the verb phrase, for example "sends payment confirmations to". It is required, and a row without one is left out.',
  '- Via names the integration platform a connection goes through. Leave it blank for a direct connection.',
  '',
  'Prefer to start from your own data? Use the other download on the Import page, "AI prompt for preparing an import file", to have an AI assistant turn your notes into a file Atlas reads.',
];

/** The workbook's sheets, in order: instructions, systems, relationships. */
export function buildImportTemplateSheets(): TemplateSheet[] {
  return [
    { name: 'Read me first', cells: INSTRUCTIONS.map((line) => [line]) },
    { name: 'Systems', cells: [headingRow(IMPORT_COLUMNS, SYSTEM_COLUMN_HEADINGS), ...exampleRows(IMPORT_COLUMNS, SYSTEM_EXAMPLES)] },
    { name: 'Relationships', cells: [headingRow(RELATIONSHIP_IMPORT_COLUMNS, RELATIONSHIP_COLUMN_HEADINGS), ...exampleRows(RELATIONSHIP_IMPORT_COLUMNS, RELATIONSHIP_EXAMPLES)] },
  ];
}
