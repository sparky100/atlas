/**
 * F2 (full K1) PR10/PR13, SPEC-capture.md §12.4/§12.6: `pnpm capture:score
 * [--fixture <id>] [--json] [--live]` — runs fixtures in `src/capture/fixtures/`
 * through `runCapture()`, the same function `capture-run` (PR12) calls, and
 * scores the result against `expected.json` via the one scorer
 * (`src/capture/fixtures/expectedOutcome.ts`) `src/capture/fixtures.test.ts`
 * (the regression suite gated into `pnpm test`) also calls — a
 * human-readable report over the same numbers, never a second oracle.
 *
 * Default (replay): every fixture directory, `RecordedLlmClient` in replay
 * mode, scored against the strict 1.0 gates. A fixture whose own
 * `expected.json` carries a `live` tolerances block but has no recorded
 * cassette for the request it needs (08/10, PR13's own disclosed gap — see
 * `src/capture/fixtures/README.md`) is reported as `SKIP (live-only, no
 * cassette)` rather than a hard failure — it genuinely isn't part of the
 * replay regression gate yet, and that's not the same thing as broken.
 *
 * `--live` (§12.6): every fixture with a `live` tolerances block (02, 08,
 * 10) is run against a *real* `LlmClient` — `DirectLlmClient` with
 * `ANTHROPIC_API_KEY` by default, or `ProxyLlmClient` if
 * `CAPTURE_LIVE_PROXY_URL`/`CAPTURE_LIVE_PROXY_ORG_ID`/`CAPTURE_LIVE_PROXY_TOKEN`
 * are all set — wrapped in `RecordingLlmClient` so every request/response
 * pair actually made is written to `.tmp/capture-live/{fixtureId}/{hash}.json`
 * (git-ignored scratch, never the fixture's own committed `llm/`). Scored
 * against `expected.live`'s tolerances, not the strict replay gates (§12.6:
 * "prose extraction is not byte-deterministic across model versions").
 * Writes `docs/review/capture-scores.md` — the file this repo's own
 * workflow says to regenerate and commit, alongside a reviewed promotion of
 * the fresh cassettes into the fixture's own `llm/`, before relying on a
 * prompt/model change. Disclosed: this path has never been run for real in
 * this sandbox (no Anthropic key here) — see `docs/EDGE-FUNCTIONS.md` and
 * this repo's own standing "no live LLM key" note.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixture } from '../src/capture/fixtures/loadFixture';
import type { ExpectedOutcome } from '../src/capture/fixtures/expectedOutcome';
import { scoreFixture, type FixtureScore } from '../src/capture/fixtures/expectedOutcome';
import { DEFAULT_CAPTURE_MODEL, DirectLlmClient, hashLlmRequest, ProxyLlmClient, type LlmClient, type LlmRequest, type LlmResponse, type RecordedLlmCassette } from '../src/capture/llm/client';
import { PROMPT_VERSION } from '../src/capture/prompts';
import { runCapture, type RunCaptureResult } from '../src/capture/runCapture';
import { isCliEntrypoint } from './isCliEntrypoint';

const FIXTURES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'capture', 'fixtures');
const LIVE_CASSETTE_SCRATCH_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp', 'capture-live');
const CAPTURE_SCORES_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'review', 'capture-scores.md');
const NO_CASSETTE_MESSAGE = 'RecordedLlmClient: no cassette for request hash';

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

// ---------------------------------------------------------------------------
// Replay mode (default).
// ---------------------------------------------------------------------------

interface ReplayOutcome {
  fixtureId: string;
  skipped?: string;
  score?: FixtureScore;
}

async function scoreOneReplay(id: string): Promise<ReplayOutcome> {
  const fixture = loadFixture(FIXTURES_ROOT, id);
  const expected = fixture.expectedRaw as ExpectedOutcome;
  let result: RunCaptureResult;
  try {
    result = await runCapture({
      inputName: `${id}.${fixture.options.format}`,
      source: fixture.source,
      documentDate: fixture.options.documentDate,
      llmClient: fixture.llmClient,
      matchIndex: fixture.matchIndex,
      mainHead: fixture.head,
      ...(fixture.reimportPrevious ? { reimportPrevious: fixture.reimportPrevious } : {}),
      mintId: mintId(id),
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes(NO_CASSETTE_MESSAGE)) {
      return { fixtureId: id, skipped: 'live-only, no cassette recorded yet — run --live once an Anthropic key is available' };
    }
    throw e;
  }
  return { fixtureId: id, score: scoreFixture(id, result, expected, fixture.keyToId) };
}

function printReplay(outcomes: readonly ReplayOutcome[]): void {
  for (const outcome of outcomes) {
    if (outcome.skipped) {
      console.log(`SKIP  ${outcome.fixtureId}  (${outcome.skipped})`);
      continue;
    }
    const score = outcome.score;
    if (!score) continue;
    console.log(`${score.pass ? 'PASS' : 'FAIL'}  ${score.fixtureId}`);
    console.log(`  elementRecall=${score.metrics.elementRecall.toFixed(2)} elementPrecision=${score.metrics.elementPrecision.toFixed(2)} relationshipRecall=${score.metrics.relationshipRecall.toFixed(2)} relationshipPrecision=${score.metrics.relationshipPrecision.toFixed(2)}`);
    console.log(`  classAccuracy=${score.metrics.classAccuracy.toFixed(2)} matchAccuracy=${score.metrics.matchAccuracy.toFixed(2)} attributeAccuracy=${score.metrics.attributeAccuracy.toFixed(2)} confidenceInRange=${score.metrics.confidenceInRange.toFixed(2)} falseMergeCount=${String(score.metrics.falseMergeCount)}`);
    for (const failure of score.failures) console.log(`    - ${failure}`);
  }
}

async function runReplay(ids: readonly string[], json: boolean): Promise<number> {
  const outcomes: ReplayOutcome[] = [];
  for (const id of ids) outcomes.push(await scoreOneReplay(id));

  if (json) {
    console.log(JSON.stringify(outcomes, null, 2));
  } else {
    printReplay(outcomes);
  }

  return outcomes.every((o) => o.skipped !== undefined || o.score?.pass === true) ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Live mode (§12.6).
// ---------------------------------------------------------------------------

/** Wraps a real `LlmClient`, recording every request/response pair it actually makes — the live-mode cassette source. Never used in replay (a test double for the network is `RecordedLlmClient`'s own job, not this one's — this class exists only to capture a *real* call, never to fabricate one). */
class RecordingLlmClient implements LlmClient {
  readonly recorded = new Map<string, RecordedLlmCassette>();
  constructor(private readonly inner: LlmClient) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.inner.complete(request);
    this.recorded.set(hashLlmRequest(request), { text: response.text, stopReason: response.stopReason, inputTokens: response.inputTokens, outputTokens: response.outputTokens, cacheReadTokens: response.cacheReadTokens });
    return response;
  }
}

interface LiveClientConfig {
  model: string;
  client: LlmClient;
}

/** §12.6: "uses DirectLlmClient (or the proxy)" — Direct (env `ANTHROPIC_API_KEY`) is the default for a standalone CLI script with no Supabase project in hand; the proxy is opted into by setting all three `CAPTURE_LIVE_PROXY_*` env vars. */
function buildLiveClient(): LiveClientConfig {
  const proxyUrl = process.env.CAPTURE_LIVE_PROXY_URL;
  const proxyOrgId = process.env.CAPTURE_LIVE_PROXY_ORG_ID;
  const proxyToken = process.env.CAPTURE_LIVE_PROXY_TOKEN;
  if (proxyUrl && proxyOrgId && proxyToken) {
    return { model: process.env.CAPTURE_LIVE_MODEL ?? DEFAULT_CAPTURE_MODEL, client: new ProxyLlmClient({ proxyUrl, authToken: proxyToken, orgId: proxyOrgId }) };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('--live needs ANTHROPIC_API_KEY (DirectLlmClient) or CAPTURE_LIVE_PROXY_URL/CAPTURE_LIVE_PROXY_ORG_ID/CAPTURE_LIVE_PROXY_TOKEN (ProxyLlmClient) set. Neither was found — see this script\'s own module comment.');
  }
  return { model: process.env.CAPTURE_LIVE_MODEL ?? DEFAULT_CAPTURE_MODEL, client: new DirectLlmClient({ apiKey }) };
}

interface LiveOutcome {
  fixtureId: string;
  pass: boolean;
  failures: string[];
  elementRecall: number;
  elementPrecision: number;
  unsourcedCount: number;
  falseMergeCount: number;
  usage: { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

function writeCassettes(fixtureId: string, recorded: ReadonlyMap<string, RecordedLlmCassette>): void {
  const dir = path.join(LIVE_CASSETTE_SCRATCH_ROOT, fixtureId);
  mkdirSync(dir, { recursive: true });
  for (const [hash, cassette] of recorded) {
    writeFileSync(path.join(dir, `${hash}.json`), JSON.stringify(cassette, null, 2));
  }
}

async function scoreOneLive(id: string, buildClient: () => LlmClient): Promise<LiveOutcome> {
  const fixture = loadFixture(FIXTURES_ROOT, id);
  const expected = fixture.expectedRaw as ExpectedOutcome;
  const liveTolerances = expected.live;
  if (!liveTolerances) throw new Error(`scoreOneLive: fixture "${id}" has no expected.json "live" block — --live only runs fixtures that declare one.`);

  const recorder = new RecordingLlmClient(buildClient());
  const result = await runCapture({
    inputName: `${id}.${fixture.options.format}`,
    source: fixture.source,
    documentDate: fixture.options.documentDate,
    llmClient: recorder,
    matchIndex: fixture.matchIndex,
    mainHead: fixture.head,
    ...(fixture.reimportPrevious ? { reimportPrevious: fixture.reimportPrevious } : {}),
    mintId: mintId(id),
  });
  writeCassettes(id, recorder.recorded);

  const usage = [...recorder.recorded.values()].reduce((acc, c) => ({ calls: acc.calls + 1, inputTokens: acc.inputTokens + c.inputTokens, outputTokens: acc.outputTokens + c.outputTokens, cacheReadTokens: acc.cacheReadTokens + c.cacheReadTokens }), { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });

  if (result.status !== 'parsed') {
    return { fixtureId: id, pass: false, failures: [`job failed: ${result.errorCode} ${result.message}`], elementRecall: 0, elementPrecision: 0, unsourcedCount: 0, falseMergeCount: 0, usage };
  }

  // Reuses the one scorer (never a second oracle, §12.4) for the numbers; §12.6's own tolerances decide pass/fail here, not the strict 1.0 replay gate `score.pass` computes.
  const score = scoreFixture(id, result, expected, fixture.keyToId);
  const unsourcedCount = result.candidates.filter((c) => c.class === 'unsourced').length;
  const failures: string[] = [];
  if (score.metrics.elementRecall < liveTolerances.minElementRecall) failures.push(`elementRecall ${score.metrics.elementRecall.toFixed(2)} < ${String(liveTolerances.minElementRecall)}`);
  if (score.metrics.elementPrecision < liveTolerances.minElementPrecision) failures.push(`elementPrecision ${score.metrics.elementPrecision.toFixed(2)} < ${String(liveTolerances.minElementPrecision)}`);
  if (unsourcedCount > liveTolerances.maxUnsourced) failures.push(`unsourced ${String(unsourcedCount)} > ${String(liveTolerances.maxUnsourced)}`);
  if (score.metrics.falseMergeCount > 0) failures.push(`${String(score.metrics.falseMergeCount)} false merge(s)`);

  return { fixtureId: id, pass: failures.length === 0, failures, elementRecall: score.metrics.elementRecall, elementPrecision: score.metrics.elementPrecision, unsourcedCount, falseMergeCount: score.metrics.falseMergeCount, usage };
}

function liveFixtureIds(): string[] {
  return listFixtureIds().filter((id) => {
    const expected = loadFixture(FIXTURES_ROOT, id).expectedRaw as ExpectedOutcome;
    return expected.live !== undefined;
  });
}

function writeCaptureScoresReport(model: string, outcomes: readonly LiveOutcome[]): void {
  const totalUsage = outcomes.reduce((acc, o) => ({ calls: acc.calls + o.usage.calls, inputTokens: acc.inputTokens + o.usage.inputTokens, outputTokens: acc.outputTokens + o.usage.outputTokens, cacheReadTokens: acc.cacheReadTokens + o.usage.cacheReadTokens }), { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
  const lines: string[] = [
    '# Capture live-mode scores',
    '',
    `Generated by \`pnpm capture:score --live\` (SPEC-capture.md §12.6). Model \`${model}\`, prompt version \`${PROMPT_VERSION}\`.`,
    '',
    '| Fixture | Pass | Element recall | Element precision | Unsourced | False merges |',
    '|---|---|---|---|---|---|',
    ...outcomes.map((o) => `| ${o.fixtureId} | ${o.pass ? 'yes' : 'no'} | ${o.elementRecall.toFixed(2)} | ${o.elementPrecision.toFixed(2)} | ${String(o.unsourcedCount)} | ${String(o.falseMergeCount)} |`),
    '',
    `Total usage: ${String(totalUsage.calls)} calls, ${String(totalUsage.inputTokens)} input tokens, ${String(totalUsage.outputTokens)} output tokens, ${String(totalUsage.cacheReadTokens)} cache-read tokens.`,
    '',
    ...outcomes.flatMap((o) => (o.failures.length > 0 ? [`## ${o.fixtureId}`, '', ...o.failures.map((f) => `- ${f}`), ''] : [])),
    `Fresh cassettes were written to \`.tmp/capture-live/{fixtureId}/\` (git-ignored) — review them and, if they look right, copy the ones you want into that fixture's own \`llm/\` directory to update the replay suite (§12.6: "that is how the replay suite tracks the live behaviour rather than freezing a stale one").`,
    '',
  ];
  mkdirSync(path.dirname(CAPTURE_SCORES_PATH), { recursive: true });
  writeFileSync(CAPTURE_SCORES_PATH, lines.join('\n'));
}

async function runLive(fixtureFilter: string | null, json: boolean): Promise<number> {
  const { model, client } = buildLiveClient();
  const ids = fixtureFilter ? [fixtureFilter] : liveFixtureIds();
  if (ids.length === 0) throw new Error('runLive: no fixture has an expected.json "live" block to run.');

  const outcomes: LiveOutcome[] = [];
  for (const id of ids) outcomes.push(await scoreOneLive(id, () => client));

  writeCaptureScoresReport(model, outcomes);

  if (json) {
    console.log(JSON.stringify(outcomes, null, 2));
  } else {
    for (const outcome of outcomes) {
      console.log(`${outcome.pass ? 'PASS' : 'FAIL'}  ${outcome.fixtureId}  (live)`);
      console.log(`  elementRecall=${outcome.elementRecall.toFixed(2)} elementPrecision=${outcome.elementPrecision.toFixed(2)} unsourced=${String(outcome.unsourcedCount)} falseMergeCount=${String(outcome.falseMergeCount)}`);
      for (const failure of outcome.failures) console.log(`    - ${failure}`);
    }
    console.log(`\nWrote ${CAPTURE_SCORES_PATH}`);
  }

  return outcomes.every((o) => o.pass) ? 0 : 1;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { fixture, json, live } = parseArgs(process.argv.slice(2));
  const exitCode = live ? await runLive(fixture, json) : await runReplay(fixture ? [fixture] : listFixtureIds(), json);
  process.exit(exitCode);
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
