/**
 * Sprint U4-1 C6: `pnpm content:export-capability-map <org> <model> <sector> <version>`.
 *
 * Walks `<model>`'s (in `<org>`, both slugs) capability tree at main head
 * and writes `content/capability-maps/<sector>/<version>.json` — names,
 * definitions, order, parent structure; every model-specific attribute
 * dropped (src/db/exportCapabilityMap.ts's own module comment has the
 * full reasoning for what's carried over and what isn't). Regenerates
 * docs/review/capability-maps.md afterwards (scripts/reviewCapabilityMaps.ts's
 * `regenerateCapabilityMapsReviewDoc`, called in-process, not shelled out
 * to) — the sprint item's own "regenerates docs/review/capability-maps.md".
 *
 * Always writes `status: "draft"` with the same "Pending human review"
 * placeholder every hand-authored map starts with (content/capability-maps/
 * README.md's own workflow: draft -> a human reviews and edits
 * `reviewedBy` -> `pnpm content:load-capability-maps` again -> `pnpm
 * content:publish-capability-map`). This script only writes the file; it
 * does not load it into the database itself — run
 * `pnpm content:load-capability-maps` next, the same as for a hand-edited
 * file.
 *
 * Refuses to overwrite an existing file — re-exporting the same
 * (sector, version) after a human has started editing it (replacing the
 * placeholder, correcting a description) would silently discard that
 * work; delete the file first, or export a new version, to get a fresh
 * snapshot.
 *
 * Read-only against Supabase (no model data is written), so this runs as
 * service_role like scripts/backfillCommitTitles.ts — there's no
 * provenance concern here the way there is for scripts/
 * syncDescriptionsFromMap.ts's own real-session requirement, since
 * nothing in the model itself changes.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServiceRoleClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { getOrganisationBySlug } from '../src/db/organisations';
import { getModelBySlug } from '../src/db/models';
import { exportCapabilityMap } from '../src/db/exportCapabilityMap';
import { parseCapabilityMapContent, SECTORS, type CapabilityMapContent, type CapabilityMapItemContent, type CapabilityMapSourceContent } from '../src/contracts/capabilityMapContent';
import { isCliEntrypoint } from './isCliEntrypoint';
import { regenerateCapabilityMapsReviewDoc } from './reviewCapabilityMaps';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_ROOT = path.join(REPO_ROOT, 'content', 'capability-maps');

function serializeSource(source: CapabilityMapSourceContent): string {
  const parts = [`"citation": ${JSON.stringify(source.citation)}`];
  if (source.url !== undefined) parts.push(`"url": ${JSON.stringify(source.url)}`);
  parts.push(`"reviewedBy": ${JSON.stringify(source.reviewedBy)}`, `"reviewedAt": ${JSON.stringify(source.reviewedAt)}`);
  return `{ ${parts.join(', ')} }`;
}

function serializeItem(item: CapabilityMapItemContent): string {
  const parts = [
    `"code": ${JSON.stringify(item.code)}`,
    `"name": ${JSON.stringify(item.name)}`,
    `"level": ${String(item.level)}`,
    `"order": ${String(item.order)}`,
    `"parentCode": ${item.parentCode === null ? 'null' : JSON.stringify(item.parentCode)}`,
  ];
  if (item.description !== undefined) parts.push(`"description": ${JSON.stringify(item.description)}`);
  return `{ ${parts.join(', ')} }`;
}

/** Matches this repo's own hand-authored formatting exactly (content/capability-maps/*.json): 2-space indent, one compact single-line object per source/item — not `JSON.stringify(..., null, 2)`, which would spread each item across many lines and produce a much noisier diff for anyone reviewing the export. */
export function serializeCapabilityMapContent(content: CapabilityMapContent): string {
  const lines: string[] = [
    '{',
    `  "sector": ${JSON.stringify(content.sector)},`,
    `  "version": ${String(content.version)},`,
    `  "status": ${JSON.stringify(content.status)},`,
    `  "title": ${JSON.stringify(content.title)},`,
    `  "summary": ${JSON.stringify(content.summary)},`,
    `  "sourceDescription": ${JSON.stringify(content.sourceDescription)},`,
    '  "sources": [',
  ];
  content.sources.forEach((source, i) => {
    lines.push(`    ${serializeSource(source)}${i < content.sources.length - 1 ? ',' : ''}`);
  });
  lines.push('  ],', '  "items": [');
  content.items.forEach((item, i) => {
    lines.push(`    ${serializeItem(item)}${i < content.items.length - 1 ? ',' : ''}`);
  });
  lines.push('  ]', '}');
  return lines.join('\n') + '\n';
}

function usageError(message: string): never {
  console.error(`${message}\n\nUsage: pnpm content:export-capability-map <org> <model> <sector> <version>\nSectors: ${SECTORS.join(', ')}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [orgSlug, modelSlug, sectorArg, versionArg] = process.argv.slice(2);
  if (!orgSlug || !modelSlug || !sectorArg || !versionArg) usageError('org, model, sector and version are all required.');
  if (!(SECTORS as readonly string[]).includes(sectorArg)) usageError(`"${sectorArg}" is not a known sector.`);
  const sector = sectorArg as (typeof SECTORS)[number];
  const version = Number(versionArg);
  if (!Number.isInteger(version) || version <= 0) usageError(`"${versionArg}" is not a valid version (a positive integer).`);

  const targetPath = path.join(CONTENT_ROOT, sector, `${String(version)}.json`);
  if (existsSync(targetPath)) {
    usageError(`content/capability-maps/${sector}/${String(version)}.json already exists — delete it first, or export a new version, rather than silently overwriting it.`);
  }

  const env = loadEnv();
  const supabase = createServiceRoleClient(env);

  const org = await getOrganisationBySlug(supabase, orgSlug);
  if (!org) usageError(`no organisation found with slug "${orgSlug}".`);
  const model = await getModelBySlug(supabase, org.id, modelSlug);
  if (!model) usageError(`no model found with slug "${modelSlug}" in organisation "${orgSlug}".`);

  const content = await exportCapabilityMap(supabase, {
    modelId: model.id,
    modelName: model.name,
    orgName: org.name,
    orgSlug,
    modelSlug,
    sector,
    version,
  });

  // Self-check: the exact parser scripts/loadCapabilityMaps.ts and
  // src/contracts/capabilityMaps.content.test.ts both use — a bug in
  // buildCapabilityMapExport should fail loudly here, not produce a file
  // the loader rejects later with no context.
  parseCapabilityMapContent(content, `${sector}/${String(version)}.json (export, not yet written)`);

  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, serializeCapabilityMapContent(content), 'utf8');
  console.log(`Wrote content/capability-maps/${sector}/${String(version)}.json (${String(content.items.length)} item(s)) from model "${model.name}".`);

  regenerateCapabilityMapsReviewDoc();

  console.log(`Next: review and edit the file (replace the "Pending human review" placeholder), then run "pnpm content:load-capability-maps".`);
}

// Only run main() when this is the CLI entrypoint.
if (isCliEntrypoint(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
