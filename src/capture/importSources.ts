/**
 * What the capture dialog offers under "What are you importing?". Each entry
 * is one description the dialog renders from, so adding a source (another
 * tool's export, later a live connector) means adding an entry here and its
 * converter (`src/capture/adapters/`), not another hand-built block in the
 * dialog. Everything after upload (matching, review, re-import) is shared.
 */
export type ImportSourceId = 'documents' | 'mulesoft';

export interface ImportSource {
  id: ImportSourceId;
  /** `documents` is the user's own files and notes; `tool-export` is a file another tool produced, read by a converter before the run starts. */
  group: 'documents' | 'tool-export';
  title: string;
  /** One line on what this brings in, shown on the card. */
  summary: string;
  /** The sentence under the dialog title once this source is chosen. */
  intro: string;
  /** How to get the file, in order. Empty for `documents`, which needs none. */
  exportSteps: readonly string[];
}

export const IMPORT_SOURCES: readonly ImportSource[] = [
  {
    id: 'documents',
    group: 'documents',
    title: 'Documents and notes',
    summary: 'A spreadsheet, JSON file or PDF, or pasted meeting notes.',
    intro: 'Upload a spreadsheet, JSON file, or PDF, or paste in meeting notes — an AI extraction reads it, matches what it finds against this model, and produces a draft you review before anything changes.',
    exportSteps: [],
  },
  {
    id: 'mulesoft',
    group: 'tool-export',
    title: 'MuleSoft Anypoint',
    summary: 'APIs, the applications that use them and what sits behind them, from an export file.',
    intro: 'Convert a MuleSoft Anypoint export into a draft you review before anything changes: one integration platform, an interface per API and a flow from each client application.',
    exportSteps: [
      'Download the export script and run it on your own machine: it asks the Anypoint CLI for your APIs and their contracts, and reads no secrets.',
      'In a terminal with the Anypoint CLI logged in, run `node mulesoft-export.mjs --env Production` (repeat `--env` for more environments). It writes `mulesoft-export.json`.',
      'Check the file for anything confidential, then choose it below.',
    ],
  },
];

export const DEFAULT_IMPORT_SOURCE: ImportSourceId = 'documents';

export function importSourceById(id: ImportSourceId): ImportSource {
  const source = IMPORT_SOURCES.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`Unknown import source "${id}".`);
  return source;
}

export const IMPORT_SOURCE_GROUP_LABELS: Record<ImportSource['group'], string> = {
  documents: 'Your own files',
  'tool-export': "From a tool's export",
};
