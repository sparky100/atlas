/**
 * F2 (full K1) PR10, SPEC-capture.md §12.4: `pnpm capture:score [--fixture <id>] [--json]`
 * — runs every fixture in `src/capture/fixtures/` through `runCapture()`,
 * the same function `capture-run` (PR12) calls, with each fixture's own
 * `RecordedLlmClient` in replay mode, and scores the result against its own
 * `expected.json` via the one scorer `src/capture/fixtures.test.ts` (the
 * regression suite gated into `pnpm test`) also calls — a human-readable
 * report over the same numbers, never a second oracle.
 *
 * `--live` (§12.6: real `DirectLlmClient`/`ProxyLlmClient` calls against
 * fixtures 02/08/10, fresh cassettes, `docs/review/capture-scores.md`) is
 * PR13's own scope — fixtures 08-10 don't exist yet and this sandbox has no
 * Anthropic key to record against. Passing `--live` here fails loudly with
 * that explanation rather than silently falling back to replay.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixture } from '../src/capture/fixtures/loadFixture';
import type { ExpectedOutcome } from '../src/capture/fixtures/expectedOutcome';
import { scoreFixture } from '../src/capture/fixtures/expectedOutcome';
import { runCapture } from '../src/capture/runCapture';
import { isCliEntrypoint } from './isCliEntrypoint';

const FIXTURES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'capture', 'fixtures');

function parseArgs(argv: readonly string[]): { fixture: string | null; json: boolean; live: boolean } {
  let fixture: string | null = null;
  let json = false;
  let live = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--fixture') fixture = argv[++i] ?? null;
    else if (arg === '--json') json = true;
    else if (arg === '--live') live = true;
  }
  return { fixture, json, live };
}

function listFixtureIds(): string[] {
  return readdirSync(FIXTURES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function mintId(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-minted-${String(n++)}`;
}

async function scoreOne(id: string) {
  const fixture = loadFixture(FIXTURES_ROOT, id);
  const expected = fixture.expectedRaw as ExpectedOutcome;
  const result = await runCapture({
    inputName: `${id}.${fixture.options.format}`,
    source: fixture.source,
    documentDate: fixture.options.documentDate,
    llmClient: fixture.llmClient,
    matchIndex: fixture.matchIndex,
    mainHead: fixture.head,
    ...(fixture.reimportPrevious ? { reimportPrevious: fixture.reimportPrevious } : {}),
    mintId: mintId(id),
  });
  return scoreFixture(id, result, expected, fixture.keyToId);
}

async function main(): Promise<void> {
  const { fixture, json, live } = parseArgs(process.argv.slice(2));

  if (live) {
    console.error('--live is not implemented yet: fixtures 02/08/10 and docs/review/capture-scores.md are PR13\'s own scope (SPEC-capture.md §12.6). Run without --live for the replay regression gate.');
    process.exit(1);
  }

  const ids = fixture ? [fixture] : listFixtureIds();
  const scores = [];
  for (const id of ids) {
    scores.push(await scoreOne(id));
  }

  if (json) {
    console.log(JSON.stringify(scores, null, 2));
  } else {
    for (const score of scores) {
      console.log(`${score.pass ? 'PASS' : 'FAIL'}  ${score.fixtureId}`);
      console.log(`  elementRecall=${score.metrics.elementRecall.toFixed(2)} elementPrecision=${score.metrics.elementPrecision.toFixed(2)} relationshipRecall=${score.metrics.relationshipRecall.toFixed(2)} relationshipPrecision=${score.metrics.relationshipPrecision.toFixed(2)}`);
      console.log(`  classAccuracy=${score.metrics.classAccuracy.toFixed(2)} matchAccuracy=${score.metrics.matchAccuracy.toFixed(2)} attributeAccuracy=${score.metrics.attributeAccuracy.toFixed(2)} confidenceInRange=${score.metrics.confidenceInRange.toFixed(2)} falseMergeCount=${String(score.metrics.falseMergeCount)}`);
      for (const failure of score.failures) console.log(`    - ${failure}`);
    }
  }

  process.exit(scores.every((s) => s.pass) ? 0 : 1);
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
