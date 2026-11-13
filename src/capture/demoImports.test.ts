/**
 * The two demo organisations' import files (docs/demo/) are real input to the
 * real importer. This test keeps them honest: each file parses with no row
 * errors, every capability it names exists in the matching starter map, and
 * every relationship/change endpoint resolves to a system or module the same
 * file introduces — so a file that passes here imports cleanly.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IDENTITY_TRIGRAM_THRESHOLD, trigramSimilarity } from '../engine/trigram';
import { normaliseName } from './normalise';
import { parseImportJsonText } from './parseImportJson';

const ROOT = path.resolve(__dirname, '..', '..');

const DEMOS = [
  { file: 'docs/demo/northbridge-dno.import.json', map: 'content/capability-maps/electricity_network/4.json' },
  { file: 'docs/demo/meridian-retail.import.json', map: 'content/capability-maps/retail_energy/1.json' },
] as const;

interface RawSystem { name: string; description?: string; platform?: string; capability?: string; quote?: string; confidence?: number }
interface RawEntry { name?: string; from?: string; to?: string; via?: string; platform?: string; capability?: string; replaced_by?: string; quote?: string; confidence?: number }
interface RawImport { systems: RawSystem[]; relationships: RawEntry[]; changes: RawEntry[] }

describe.each(DEMOS)('demo import $file', ({ file, map }) => {
  const text = readFileSync(path.join(ROOT, file), 'utf8');
  const raw = JSON.parse(text) as RawImport;
  const capabilityNames = new Set((JSON.parse(readFileSync(path.join(ROOT, map), 'utf8')) as { items: { name: string }[] }).items.map((i) => i.name.toLowerCase()));

  const known = new Set<string>();
  for (const s of raw.systems) known.add((s.platform ? `${s.platform} · ${s.name}` : s.name).toLowerCase());
  const topLevel = new Set(raw.systems.filter((s) => !s.platform).map((s) => s.name.toLowerCase()));

  it('parses with no row errors', () => {
    const parsed = parseImportJsonText(text, file);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(raw.systems.length);
    expect(parsed.relationshipRows).toHaveLength(raw.relationships.length);
    expect(parsed.changeRows).toHaveLength(raw.changes.length);
  });

  it('only names capabilities that exist in its starter map', () => {
    const missing = raw.systems.flatMap((s) => (s.capability ?? '').split('|').filter(Boolean).filter((c) => !capabilityNames.has(c.toLowerCase())).map((c) => `${s.name}: ${c}`));
    expect(missing).toEqual([]);
  });

  it('has unique system names and resolvable platforms, endpoints and replacements', () => {
    expect(known.size).toBe(raw.systems.length);
    expect(raw.systems.filter((s) => s.platform && !topLevel.has(s.platform.toLowerCase()))).toEqual([]);
    const resolves = (ref: string) => known.has(ref.toLowerCase());
    const bad = [
      ...raw.relationships.flatMap((r) => [r.from, r.to, r.via].filter((x): x is string => !!x && !resolves(x))),
      ...raw.changes.flatMap((c) => [c.name, c.replaced_by].filter((x): x is string => !!x && !resolves(x))),
    ];
    expect(bad).toEqual([]);
  });

  it('gives every system a description of at least a short sentence', () => {
    expect(raw.systems.filter((s) => (s.description ?? '').trim().length < 40).map((s) => s.name)).toEqual([]);
  });

  it('has no two systems (or modules of one platform) so similarly named that the importer treats them as one', () => {
    // The importer merges near-identical names (trigram identity threshold): "Settlement Engine" and "MHHS Settlement Engine" collapsed into one element, and re-importing then wrote the same ownership edge twice and failed.
    const similar: string[] = [];
    raw.systems.forEach((a, i) => {
      raw.systems.slice(i + 1).forEach((b) => {
        if ((a.platform ?? '') !== (b.platform ?? '')) return;
        if (trigramSimilarity(normaliseName(a.name), normaliseName(b.name)) >= IDENTITY_TRIGRAM_THRESHOLD) similar.push(`${a.name} ~ ${b.name}`);
      });
    });
    expect(similar).toEqual([]);
  });

  it('never names an external organisation as an owner (an external actor can only own with the service role, C20)', () => {
    const external = raw.systems.flatMap((sys) => Object.entries(sys as unknown as Record<string, unknown>).filter(([k, v]) => k.endsWith('_owner') && typeof v === 'string' && v.includes('(External:')).map(([k]) => `${sys.name}.${k}`));
    expect(external).toEqual([]);
  });

  it('carries provenance on every entry', () => {
    for (const e of [...raw.systems, ...raw.relationships, ...raw.changes]) {
      expect(e.quote).toBeTruthy();
      expect(e.confidence).toBeGreaterThan(0);
    }
  });
});
