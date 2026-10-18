/**
 * What the capture upload dialog does with a MuleSoft export before the run
 * starts (SPEC-capture.md §5.6's JSON path): read the file the export script
 * wrote, convert it (`mulesoft.ts`), and hand the converted import JSON on as
 * the run's input — the dialog stores and re-imports *that* file, so the
 * review queue, matching and re-import diff are the ordinary ones. Pure, so
 * the part of the dialog that can go wrong is unit-testable without a DOM.
 */
import { convertMulesoftExport, parseMulesoftExport, type MulesoftConversionReport } from './mulesoft';

export interface AliasParseResult {
  aliases: Record<string, string>;
  errors: string[];
}

/** One mapping per line, `backend hostname = Atlas element name` (also `->` or a comma). Blank lines and `#` comments are ignored. */
export function parseAliasText(text: string): AliasParseResult {
  const aliases: Record<string, string> = {};
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const match = /^(.+?)\s*(?:=>|->|=|,)\s*(.+)$/.exec(line);
    const host = match?.[1]?.trim().toLowerCase();
    const target = match?.[2]?.trim();
    if (host === undefined || host === '' || target === undefined || target === '') {
      errors.push(`Line ${String(index + 1)}: expected "hostname = Atlas element name".`);
      return;
    }
    aliases[host] = target;
  });
  return { aliases, errors };
}

export type PreparedMulesoftUpload =
  | { ok: true; inputName: string; bytes: Uint8Array; summary: string; warnings: string[] }
  | { ok: false; error: string };

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function summaryOf(report: MulesoftConversionReport): string {
  const { interfaces, consumers, relationships, flowsToProducer } = report.counts;
  const flows = flowsToProducer > 0 ? ` (${plural(flowsToProducer, 'flow', 'flows')} to a mapped backend)` : '';
  return `${plural(interfaces, 'API interface', 'API interfaces')}, ${plural(consumers, 'client application', 'client applications')} and ${plural(relationships, 'relationship', 'relationships')}${flows} on one MuleSoft platform.`;
}

function warningsOf(report: MulesoftConversionReport): string[] {
  const warnings = [...report.warnings];
  if (report.skippedContracts.length > 0) warnings.push(`${plural(report.skippedContracts.length, 'contract was', 'contracts were')} left out (not approved, or no client application).`);
  if (report.unmappedHosts.length > 0) warnings.push(`Backend hostnames with no mapping, so their consumers link to the interface only: ${report.unmappedHosts.join(', ')}. Map them below, or save them as external references on the system's element page, to link consumers to the system behind each API.`);
  return warnings;
}

/** `savedAliases` are the model's own external references (`hostname -> Atlas name`); a line typed in the box wins over a saved one for the same hostname. */
export function prepareMulesoftUpload(input: { fileName: string; text: string; aliasText: string; savedAliases?: Record<string, string> }): PreparedMulesoftUpload {
  const parsed = parseMulesoftExport(input.text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const alias = parseAliasText(input.aliasText);
  if (alias.errors.length > 0) return { ok: false, error: alias.errors.join(' ') };
  const { importJson, report } = convertMulesoftExport(parsed.file, { aliases: { ...input.savedAliases, ...alias.aliases } });
  const inputName = input.fileName.toLowerCase().endsWith('.json') ? input.fileName : `${input.fileName}.json`;
  return { ok: true, inputName, bytes: new TextEncoder().encode(`${JSON.stringify(importJson, null, 2)}\n`), summary: summaryOf(report), warnings: warningsOf(report) };
}
