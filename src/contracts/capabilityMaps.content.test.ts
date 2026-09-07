import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCapabilityMapContent, SECTORS, type CapabilityMapContent, type CapabilityMapItemContent } from './capabilityMapContent';

/**
 * Validates every starter map under content/capability-maps/ through the
 * same parser the loader (scripts/loadCapabilityMaps.ts) and the review
 * generator (scripts/reviewCapabilityMaps.ts) use — so a file that passes
 * here loads, and a file that fails here is caught on `pnpm test`, not at
 * load time. The parser is the schema (content/capability-maps/README.md);
 * this test adds only the cross-file rules the parser can't see from one
 * file: the path/field match the loader also enforces, every sector
 * having a map, the eight shared capabilities being byte-identical in
 * every map, and the utility/electricity level-1 wording being identical.
 *
 * Editorial rules (8-12 level-1, 3-6 level-2, definitions of eight-plus
 * words, no process/org-unit names) are deliberately *not* hard failures
 * here — docs/review/capability-maps.md flags them for a human, which is
 * the point of that document.
 */

const CONTENT_ROOT = path.resolve(__dirname, '..', '..', 'content', 'capability-maps');

interface LoadedMap {
  label: string;
  sectorDir: string;
  versionFromPath: number;
  content: CapabilityMapContent;
}

function loadAllMaps(): LoadedMap[] {
  const maps: LoadedMap[] = [];
  for (const entry of readdirSync(CONTENT_ROOT)) {
    const sectorPath = path.join(CONTENT_ROOT, entry);
    if (!statSync(sectorPath).isDirectory()) continue;
    for (const file of readdirSync(sectorPath)) {
      if (!file.endsWith('.json')) continue;
      const label = `${entry}/${file}`;
      const raw: unknown = JSON.parse(readFileSync(path.join(sectorPath, file), 'utf8'));
      maps.push({ label, sectorDir: entry, versionFromPath: Number(file.replace(/\.json$/, '')), content: parseCapabilityMapContent(raw, label) });
    }
  }
  return maps.sort((a, b) => a.label.localeCompare(b.label));
}

/** The eight shared capabilities every map carries as codes 1-8, from the single copy the README points at. */
function loadSharedItems(): CapabilityMapItemContent[] {
  const raw = JSON.parse(readFileSync(path.join(CONTENT_ROOT, 'shared-capabilities.json'), 'utf8')) as { items: CapabilityMapItemContent[] };
  return raw.items;
}

const SHARED_ROOT_CODES = new Set(['1', '2', '3', '4', '5', '6', '7', '8']);

function sharedSubset(items: readonly CapabilityMapItemContent[]): CapabilityMapItemContent[] {
  return items.filter((item) => SHARED_ROOT_CODES.has(item.parentCode ?? item.code));
}

function level1(content: CapabilityMapContent): { name: string; description: string | undefined }[] {
  return content.items.filter((item) => item.level === 1).map((item) => ({ name: item.name, description: item.description }));
}

const maps = loadAllMaps();

describe('content/capability-maps (validated through parseCapabilityMapContent)', () => {
  it('finds at least one map file', () => {
    expect(maps.length).toBeGreaterThan(0);
  });

  it.each(maps.map((m) => [m.label, m] as const))('%s: path sector/version match the file (the loader enforces the same)', (_label, map) => {
    expect(map.content.sector).toBe(map.sectorDir);
    expect(map.content.version).toBe(map.versionFromPath);
  });

  it.each([...SECTORS])('sector %s has at least one map', (sector) => {
    expect(maps.some((m) => m.content.sector === sector)).toBe(true);
  });

  it.each(maps.map((m) => [m.label, m] as const))('%s: codes 1-8 are byte-identical to shared-capabilities.json', (_label, map) => {
    expect(sharedSubset(map.content.items)).toEqual(loadSharedItems());
  });

  it('utility and electricity_network share level-1 wording exactly (names and definitions)', () => {
    const utility = maps.find((m) => m.content.sector === 'utility' && m.content.version === 1);
    const electricity = maps.find((m) => m.content.sector === 'electricity_network' && m.content.version === 1);
    if (!utility || !electricity) throw new Error('expected utility/1.json and electricity_network/1.json');
    expect(level1(electricity.content)).toEqual(level1(utility.content));
  });

  it('every map stays at draft until a named human reviewer replaces the placeholder', () => {
    for (const map of maps) {
      const placeholder = map.content.sources.some((s) => /pending human review/i.test(s.reviewedBy));
      if (placeholder) expect(map.content.status, `${map.label} has an unreviewed source but is not draft`).toBe('draft');
    }
  });
});
