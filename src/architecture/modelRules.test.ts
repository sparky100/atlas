import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Scan tests for the Model rules in CLAUDE.md. Each one reads source as text
 * (the same style as `src/db/headTableReads.test.ts` and
 * `src/ui/plainEnglish.test.ts`), so a rule that used to depend on a reader
 * noticing now fails a test instead.
 *
 * A failure here is a rule being broken, not a flaky test. Either fix the
 * code, or, where the exception is real, add it to the allow-list in this
 * file with a reason a reviewer can read. Never loosen a pattern to get green.
 */

const ROOT = join(__dirname, '..', '..');

function walk(dir: string, keep: (path: string) => boolean): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, keep);
    return keep(path) ? [path] : [];
  });
}

const isTest = (p: string): boolean => /\.(test|spec)\.(ts|tsx)$/.test(p);
const isSource = (p: string): boolean => /\.(ts|tsx)$/.test(p) && !isTest(p) && !p.endsWith('.d.ts');

const appFiles = walk(join(ROOT, 'src'), isSource);
// A function with a `_source/` folder is bundled by `pnpm functions:bundle:<name>` into a generated,
// git-ignored `index.ts` that inlines everything it reaches in `src/`. Scanning that copy would flag
// code this test already checks at its source, and would make the result depend on whether someone
// has bundled for a deploy on this machine. Only hand-written files count.
const isGeneratedBundle = (p: string): boolean => /supabase[\\/]functions[\\/][^\\/]+[\\/]index\.ts$/.test(p) && existsSync(join(dirname(p), '_source'));
const functionFiles = walk(join(ROOT, 'supabase', 'functions'), (p) => isSource(p) && !isGeneratedBundle(p));
const mcpFiles = walk(join(ROOT, 'mcp', 'src'), isSource);
const rel = (p: string): string => relative(ROOT, p).split('\\').join('/');
const read = (p: string): string => readFileSync(p, 'utf8');

/** Blank out comments so a rule mentioned in a comment is not a use. Keeps line numbers. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('I1: every place that creates an element searches first', () => {
  // Files allowed to build a `kind: 'element.create'` delta. Each one either sits behind a
  // search-first control or is not a person adding one thing to a live model. Adding a file here
  // is a decision to explain in the PR (rule I1, ADR-019).
  const ALLOWED: Record<string, string> = {
    'src/contracts/delta.ts': 'the delta type itself',
    'src/ui/elements/useElementCreate.ts': 'behind ElementSearchAdd and the Home search (search-first)',
    'src/ui/elements/buildReplaceWithNewElementDeltas.ts': 'the Retire panel: searches systems and modules first, "Create new instead" is the last choice',
    'src/ui/elements/useRelationshipCreate.ts': 'relationship picker: search-first target picker',
    'src/ui/capabilityMap/useCapabilityCreate.ts': 'capability map add: search-first',
    'src/engine/convertSystemToModule.ts': 'turns an existing system into a module: replaces, does not add',
    'src/engine/copyModel.ts': 'copies a whole model into a new one',
    'src/capture/buildCaptureDraftEnvelope.ts': 'capture: the matcher (src/capture/match.ts) runs before this',
    'src/capture/buildPromotionEnvelope.ts': 'capture: a reviewer chose between new and existing',
    'src/db/seedFromMap.ts': 'seeds an empty model from a published capability map',
    'src/capture/fixtures/loadFixture.ts': 'test fixture loader, never reached from the app',
  };

  it('only the listed files build element.create deltas', () => {
    const found = appFiles.filter((p) => /kind:\s*['"]element\.create['"]/.test(withoutComments(read(p)))).map(rel);
    const unexpected = found.filter((f) => !(f in ALLOWED));
    expect(unexpected, 'A new place builds element.create. Put a search in front of it (ADR-019) and list it in ALLOWED with the reason.').toEqual([]);
  });

  it('the allow-list has no stale entries', () => {
    const found = new Set(appFiles.filter((p) => /kind:\s*['"]element\.create['"]/.test(withoutComments(read(p)))).map(rel));
    expect(Object.keys(ALLOWED).filter((f) => !found.has(f))).toEqual([]);
  });
});

describe('H1, H2: application code never writes the protected tables', () => {
  // The two head tables are projections: nothing writes them from application code at all.
  // The rest are append-only records: nothing updates or deletes them, and rows arrive through
  // functions, except a tag, which a person creates directly (rule 5 forbids changing or removing one).
  const HEADS = ['elements_head', 'relationships_head'];
  const APPEND_ONLY = ['deltas', 'commits', 'tags', 'element_merges', 'resolved_conflicts'];
  const PROTECTED = [...HEADS, ...APPEND_ONLY];
  const writeFor = (table: string): RegExp =>
    HEADS.includes(table) ? /\.(insert|update|upsert|delete)\s*\(/ : table === 'tags' ? /\.(update|upsert|delete)\s*\(/ : /\.(insert|update|upsert|delete)\s*\(/;

  it('no .from(<protected table>) is followed by insert, update, upsert or delete', () => {
    const offences: string[] = [];
    for (const path of [...appFiles, ...functionFiles, ...mcpFiles]) {
      const text = withoutComments(read(path));
      for (const match of text.matchAll(/\.from\(\s*['"`](\w+)['"`]\s*\)/g)) {
        if (!PROTECTED.includes(match[1] ?? '')) continue;
        const start = match.index;
        const semi = text.indexOf(';', start);
        const statement = text.slice(start, semi === -1 ? undefined : semi);
        if (writeFor(match[1] ?? '').test(statement)) offences.push(`${rel(path)}: ${match[1] ?? ''}`);
      }
    }
    expect(offences, 'Nothing in these tables is changed by application code. Use a delta (retract or restore) or a security-definer function.').toEqual([]);
  });
});

describe('A2: cost is removed at one place before anything reaches an AI, the API or MCP', () => {
  const CONTEXT_BUILDERS = [
    'supabase/functions/design-agent/_source/index.ts',
    'supabase/functions/review-agent/_source/index.ts',
    'supabase/functions/api/_source/index.ts',
    'supabase/functions/ask-model/_source/index.ts',
    'mcp/src/atlasTools.ts',
  ];

  it.each(CONTEXT_BUILDERS)('%s builds its model context through createToolContext', (file) => {
    expect(withoutComments(read(join(ROOT, file)))).toMatch(/createToolContext/);
  });

  it('only the tools layer reads the run-cost attribute', () => {
    const offenders = [...appFiles, ...functionFiles, ...mcpFiles]
      .filter((p) => /(src\/tools\/|supabase\/functions\/|mcp\/src\/)/.test(rel(p)))
      .filter((p) => rel(p) !== 'src/tools/runCostExclusion.ts' && withoutComments(read(p)).includes('annualRunCost'))
      .map(rel);
    expect(offenders, 'Run cost is read only in src/tools/runCostExclusion.ts (rule A2).').toEqual([]);
  });
});

describe('build rule 8: an .in() over a growing id list is size-checked', () => {
  it('every file that filters on an id list calls assertInFilterSize or splits the list (queryInChunks)', () => {
    const offenders: string[] = [];
    for (const path of [...appFiles, ...functionFiles]) {
      const text = withoutComments(read(path));
      const calls = [...text.matchAll(/\.in\(\s*['"`](\w+)['"`]/g)].filter((m) => /(^id$|_id$|_ids$)/.test(m[1] ?? ''));
      if (calls.length === 0) continue;
      const safe = /assertInFilterSize|MAX_IN|chunk/i.test(text);
      if (!safe) offenders.push(`${rel(path)}: ${[...new Set(calls.map((m) => m[1]))].join(', ')}`);
    }
    expect(offenders, 'Call assertInFilterSize before an .in() over ids that grow with the model, or chunk it (src/db/inFilterLimit.ts).').toEqual([]);
  });
});
