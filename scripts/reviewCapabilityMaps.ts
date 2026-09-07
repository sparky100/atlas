/**
 * Regenerates docs/review/capability-maps.md from content/capability-maps/:
 * per sector, the full tree with definitions; a level-1 cross-sector
 * matrix; then the items a human reviewer should look at (process- or
 * org-unit-shaped names, duplicates across levels, level-2 groups outside
 * 3-6, level-1 counts outside 8-12, definitions under eight words).
 *
 * Reads every map through parseCapabilityMapContent — the same parser
 * scripts/loadCapabilityMaps.ts loads with and
 * src/contracts/capabilityMaps.content.test.ts validates with — and
 * applies the loader's own path/field check, so this document can never
 * describe a map the loader would reject, or disagree with it about what
 * a map contains. It never edits a map: flags are for a person to act on.
 *
 * Run with `pnpm content:review-capability-maps`. Deterministic: sectors
 * sorted, items in file order, no timestamps — so re-running against
 * unchanged content produces a byte-identical document and a diff means
 * the content changed.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Explicit `.ts`: Node's ESM loader under --experimental-strip-types does
// not guess extensions the way Vite/vitest do (tsconfig's
// allowImportingTsExtensions is on for exactly this). The contract has no
// relative imports of its own, so this is the only one that needs it here.
import { parseCapabilityMapContent, type CapabilityMapContent, type CapabilityMapItemContent } from '../src/contracts/capabilityMapContent.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_ROOT = path.join(REPO_ROOT, 'content', 'capability-maps');
const OUTPUT_PATH = path.join(REPO_ROOT, 'docs', 'review', 'capability-maps.md');

const MIN_L1 = 8;
const MAX_L1 = 12;
const MIN_L2 = 3;
const MAX_L2 = 6;
const MIN_DEFINITION_WORDS = 8;

interface LoadedMap {
  label: string;
  content: CapabilityMapContent;
}

function loadMaps(): LoadedMap[] {
  const maps: LoadedMap[] = [];
  for (const entry of readdirSync(CONTENT_ROOT)) {
    const sectorPath = path.join(CONTENT_ROOT, entry);
    if (!statSync(sectorPath).isDirectory()) continue;
    for (const file of readdirSync(sectorPath)) {
      if (!file.endsWith('.json')) continue;
      const label = `${entry}/${file}`;
      const raw: unknown = JSON.parse(readFileSync(path.join(sectorPath, file), 'utf8'));
      const content = parseCapabilityMapContent(raw, label);
      // The loader's own check, repeated here for the same reason it exists
      // there: a file whose path disagrees with its fields must not be
      // described as if it were the map its path claims.
      const versionFromPath = Number(file.replace(/\.json$/, ''));
      if (entry !== content.sector || versionFromPath !== content.version) {
        throw new Error(`${label}: path implies sector/version "${entry}"/${String(versionFromPath)}, but the file itself says "${content.sector}"/${String(content.version)}`);
      }
      maps.push({ label, content });
    }
  }
  return maps.sort((a, b) => a.label.localeCompare(b.label));
}

// --- flag heuristics -------------------------------------------------------

/** Words that make a name read as an activity or a lifecycle rather than an ability. */
const PROCESS_MARKERS = /\b(process|processing|handling|workflow|lifecycle|management of|end-to-end|to-pay|to-cash|order-to|procure-to|hire-to)\b/i;
/** Words that make a name read as a part of the org chart rather than something the organisation can do. */
const ORG_UNIT_MARKERS = /\b(team|teams|department|directorate|division|unit|office|committee|desk|function)\b/i;

/**
 * A name that *opens* with an action verb's gerund reads as an activity
 * ("Managing Tenancies", "Processing Claims") rather than an ability. A
 * bare "any word ending in -ing" test was tried first and flagged 34 of
 * 36 names on the first run — Housing, Planning, Licensing, Imaging,
 * Learning, Billing, Metering are all domain nouns — so this is an explicit
 * list of verbs that are rarely a domain noun, not a suffix match.
 */
const ACTIVITY_GERUNDS = new Set([
  'managing', 'processing', 'handling', 'delivering', 'providing', 'performing', 'conducting', 'running', 'operating', 'undertaking',
  'reviewing', 'approving', 'issuing', 'collecting', 'maintaining', 'monitoring', 'assessing', 'administering', 'executing', 'coordinating',
  'preparing', 'producing', 'submitting', 'recording', 'tracking', 'resolving', 'completing', 'carrying',
]);

function leadingActivityGerund(name: string): string | null {
  const first = (name.split(/\s+/)[0] ?? '').toLowerCase();
  return ACTIVITY_GERUNDS.has(first) ? first : null;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

interface Flag {
  map: string;
  code: string;
  name: string;
  reason: string;
}

function flagsFor(map: LoadedMap): Flag[] {
  const flags: Flag[] = [];
  const { label, content } = map;
  const byCode = new Map(content.items.map((item) => [item.code, item]));
  const level1 = content.items.filter((item) => item.level === 1);

  if (level1.length < MIN_L1 || level1.length > MAX_L1) {
    flags.push({ map: label, code: '(map)', name: `${String(level1.length)} level-1 capabilities`, reason: `level-1 count outside ${String(MIN_L1)}-${String(MAX_L1)}` });
  }

  for (const parent of level1) {
    const children = content.items.filter((item) => item.parentCode === parent.code);
    if (children.length < MIN_L2 || children.length > MAX_L2) {
      flags.push({ map: label, code: parent.code, name: parent.name, reason: `${String(children.length)} level-2 entries, outside ${String(MIN_L2)}-${String(MAX_L2)}` });
    }
  }

  for (const item of content.items) {
    if (PROCESS_MARKERS.test(item.name)) flags.push({ map: label, code: item.code, name: item.name, reason: 'process-shaped name (activity/lifecycle wording)' });
    if (ORG_UNIT_MARKERS.test(item.name)) flags.push({ map: label, code: item.code, name: item.name, reason: 'org-unit-shaped name' });
    const gerund = leadingActivityGerund(item.name);
    if (gerund) flags.push({ map: label, code: item.code, name: item.name, reason: `opens with the action verb "${gerund}" — reads as an activity, not a capability` });

    if (!item.description) {
      flags.push({ map: label, code: item.code, name: item.name, reason: 'no definition' });
    } else if (wordCount(item.description) < MIN_DEFINITION_WORDS) {
      flags.push({ map: label, code: item.code, name: item.name, reason: `definition under ${String(MIN_DEFINITION_WORDS)} words (${String(wordCount(item.description))})` });
    }
  }

  // Duplicates across levels: the same name at level 1 and level 2 in one
  // map, or the same level-2 name under two different parents. Sharing a
  // name *across* maps is intentional (the shared capabilities) and is
  // shown in the matrix, not flagged.
  const namesAtLevel1 = new Set(level1.map((item) => item.name.toLowerCase()));
  const seenLevel2 = new Map<string, string>();
  for (const item of content.items) {
    if (item.level === 1) continue;
    const key = item.name.toLowerCase();
    if (namesAtLevel1.has(key)) flags.push({ map: label, code: item.code, name: item.name, reason: 'same name also used at level 1 in this map' });
    const previous = seenLevel2.get(key);
    if (previous && byCode.get(previous)?.parentCode !== item.parentCode) {
      flags.push({ map: label, code: item.code, name: item.name, reason: `same level-2 name also under ${previous.split('.')[0] ?? '?'} (as ${previous})` });
    } else if (!previous) {
      seenLevel2.set(key, item.code);
    }
  }

  return flags;
}

// --- rendering ---------------------------------------------------------------

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function renderTree(content: CapabilityMapContent): string[] {
  const lines: string[] = [];
  const children = (parent: CapabilityMapItemContent) => content.items.filter((item) => item.parentCode === parent.code);
  for (const l1 of content.items.filter((item) => item.level === 1)) {
    lines.push(`### ${l1.code}. ${l1.name}`, '', l1.description ?? '_No definition._', '');
    for (const l2 of children(l1)) {
      lines.push(`- **${l2.code} ${l2.name}** — ${l2.description ?? '_No definition._'}`);
      for (const l3 of children(l2)) lines.push(`  - **${l3.code} ${l3.name}** — ${l3.description ?? '_No definition._'}`);
    }
    lines.push('');
  }
  return lines;
}

function renderMatrix(maps: LoadedMap[]): string[] {
  const sectors = maps.map((m) => m.content.sector);
  const level1Names = [...new Set(maps.flatMap((m) => m.content.items.filter((i) => i.level === 1).map((i) => i.name)))].sort((a, b) => a.localeCompare(b));
  const header = `| Level-1 capability | ${sectors.map(escapeCell).join(' | ')} |`;
  const divider = `|---|${sectors.map(() => '---').join('|')}|`;
  const rows = level1Names.map((name) => {
    const cells = maps.map((m) => (m.content.items.some((i) => i.level === 1 && i.name === name) ? '✓' : ''));
    return `| ${escapeCell(name)} | ${cells.join(' | ')} |`;
  });
  return [header, divider, ...rows];
}

function render(maps: LoadedMap[]): string {
  const out: string[] = [
    '# Capability maps — review document',
    '',
    '_Generated by `pnpm content:review-capability-maps` (scripts/reviewCapabilityMaps.ts) from `content/capability-maps/`, read through `parseCapabilityMapContent` — the same parser the loader uses. Do not edit by hand; edit the map and regenerate. Flags below are for a reviewer to act on; this script never changes a map._',
    '',
    `Maps: ${String(maps.length)} (${maps.map((m) => `\`${m.label}\``).join(', ')}).`,
    '',
    '## 1. Per sector: full tree with definitions',
    '',
  ];

  for (const map of maps) {
    const l1Count = map.content.items.filter((i) => i.level === 1).length;
    out.push(`## ${map.content.sector} — v${String(map.content.version)} (${map.content.status}, ${String(l1Count)} level-1, ${String(map.content.items.length)} items)`, '', map.content.sourceDescription, '');
    if (map.content.sources.length > 0) {
      out.push('Sources:', '');
      for (const s of map.content.sources) out.push(`- ${s.citation}${s.url ? ` — <${s.url}>` : ''} (reviewed by ${s.reviewedBy}, ${s.reviewedAt})`);
      out.push('');
    }
    out.push(...renderTree(map.content));
  }

  out.push('## 2. Level-1 cross-sector matrix', '', 'Rows are every distinct level-1 name across all maps; a ✓ means that map has a level-1 capability with exactly that name. Identical wording across a row is the shared-capability rule working; near-duplicates on adjacent rows are worth a look.', '', ...renderMatrix(maps), '');

  const flags = maps.flatMap(flagsFor);
  out.push('## 3. Flagged items', '');
  if (flags.length === 0) {
    out.push('_Nothing flagged._', '');
  } else {
    out.push(`${String(flags.length)} flag(s). A flag is a prompt to look, not a verdict: the name heuristics are word lists, and a definition-length flag is a count, not a judgement of the sentence.`, '', '| Map | Code | Name | Reason |', '|---|---|---|---|');
    for (const f of flags) out.push(`| ${escapeCell(f.map)} | ${escapeCell(f.code)} | ${escapeCell(f.name)} | ${escapeCell(f.reason)} |`);
    out.push('');
  }

  return out.join('\n');
}

function main(): void {
  const maps = loadMaps();
  if (maps.length === 0) {
    console.log('No content/capability-maps/<sector>/<version>.json files found — nothing to review.');
    return;
  }
  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, render(maps) + '\n', 'utf8');
  console.log(`Wrote ${path.relative(REPO_ROOT, OUTPUT_PATH)} from ${String(maps.length)} map(s).`);
}

main();
