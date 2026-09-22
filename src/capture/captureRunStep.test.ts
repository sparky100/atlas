import { describe, expect, it, vi } from 'vitest';
import type { CaptureJobError, CaptureJobProgress } from '../contracts/capture';
import type { UUID } from '../contracts/delta';
import { emptyHead } from '../engine/deltas';
import { runCaptureRunStep, type CaptureRunDeps, type CaptureRunJob, type WriteCaptureDraftInput, type WriteCaptureDraftOutput } from './captureRunStep';
import { hashLlmRequest, LlmRefusalError, RecordedLlmClient, type LlmClient, type LlmRequest, type LlmResponse } from './llm/client';
import { buildMatchIndex } from './matchIndex';
import { buildPromptBUserMessage, PROMPT_B_SCHEMA, PROMPT_B_SYSTEM, type PromptBChunkLocation } from './prompts/b';
import type { RunCaptureSource } from './runCapture';

const NEVER_CALLED_LLM: LlmClient = {
  complete(): Promise<LlmResponse> {
    throw new Error('LlmClient.complete should never be called for a fully synonym-mapped sheet.');
  },
};

function mintIdFrom(prefix: string): () => UUID {
  let n = 0;
  return () => `${prefix}-${String(n++)}`;
}

const PENDING_JOB: CaptureRunJob = {
  id: 'job-1',
  orgId: 'org-1',
  modelId: 'model-1',
  inputKind: 'spreadsheet',
  inputName: 'Applications.csv',
  inputRef: 'capture-inputs/org-1/model-1/job-1/Applications.csv',
  documentDate: '2026-01-01',
  status: 'pending',
  reimportOfJobId: null,
  createdBy: 'user-1',
};

interface FakeDepsOverrides {
  job?: CaptureRunJob;
  llmClient?: LlmClient;
  source?: RunCaptureSource;
}

/**
 * A fake `CaptureRunDeps` — no network, no Postgres, no Deno. `jobState` is
 * a small mutable store standing in for the `capture_jobs` row itself, so
 * `beginAttempt`/`setError` actually change what a later `readJob` sees —
 * the same "a retry rereads whatever the previous attempt left behind"
 * relationship the real DB has, needed to test retry behaviour honestly
 * rather than asserting against a job object that never changes.
 */
function fakeDeps(overrides: FakeDepsOverrides = {}) {
  const calls: { beginAttempt: CaptureJobProgress[]; setProgress: CaptureJobProgress[]; setError: CaptureJobError[]; writeCaptureDraft: WriteCaptureDraftInput[] } = {
    beginAttempt: [],
    setProgress: [],
    setError: [],
    writeCaptureDraft: [],
  };

  const jobState = { ...(overrides.job ?? PENDING_JOB) };
  const csv = ['Application,Supplier,Status', 'CRM,Acme,Live'].join('\n');

  const deps: CaptureRunDeps = {
    readJob: vi.fn(() => Promise.resolve({ ...jobState })),
    beginAttempt: vi.fn((_jobId: UUID, progress: CaptureJobProgress) => {
      calls.beginAttempt.push(progress);
      return Promise.resolve();
    }),
    setProgress: vi.fn((_jobId: UUID, progress: CaptureJobProgress) => {
      calls.setProgress.push(progress);
      return Promise.resolve();
    }),
    setError: vi.fn((_jobId: UUID, error: CaptureJobError) => {
      calls.setError.push(error);
      return Promise.resolve();
    }),
    buildMatchIndex: vi.fn(() => Promise.resolve(buildMatchIndex([], []))),
    foldMainHead: vi.fn(() => Promise.resolve({ mainHeadCommitId: 'main-commit-0', head: emptyHead() })),
    readReimportPrevious: vi.fn(() => Promise.resolve([])),
    getOrCreateJobSource: vi.fn((_job: CaptureRunJob, _source: RunCaptureSource) => Promise.resolve('source-1')),
    downloadInput: vi.fn(() => Promise.resolve(overrides.source ?? { format: 'csv' as const, text: csv })),
    llmClient: overrides.llmClient ?? NEVER_CALLED_LLM,
    mintId: mintIdFrom('id'),
    writeCaptureDraft: vi.fn((input: WriteCaptureDraftInput): Promise<WriteCaptureDraftOutput> => {
      calls.writeCaptureDraft.push(input);
      jobState.status = 'parsed';
      return Promise.resolve({ branchId: input.branchId });
    }),
  };

  return { deps, calls, jobState };
}

describe('runCaptureRunStep', () => {
  it('is idempotent: a job that is already parsed/reviewed/discarded is a no-op that touches nothing else', async () => {
    for (const status of ['parsed', 'reviewed', 'discarded'] as const) {
      const { deps, calls } = fakeDeps({ job: { ...PENDING_JOB, status } });
      const result = await runCaptureRunStep(deps, PENDING_JOB.id);
      expect(result).toEqual({ status: 'noop', jobStatus: status });
      expect(deps.buildMatchIndex).not.toHaveBeenCalled();
      expect(deps.writeCaptureDraft).not.toHaveBeenCalled();
      expect(calls.beginAttempt).toEqual([]);
    }
  });

  it('throws for a jobId with no row at all (a caller bug, not a capture failure)', async () => {
    const { deps } = fakeDeps();
    deps.readJob = vi.fn(() => Promise.resolve(null));
    await expect(runCaptureRunStep(deps, 'missing-job')).rejects.toThrow(/not found/);
  });

  it('runs the whole pipeline in one invocation and writes a draft (happy path)', async () => {
    const { deps, calls } = fakeDeps();
    const result = await runCaptureRunStep(deps, PENDING_JOB.id);

    expect(result.status).toBe('parsed');
    if (result.status !== 'parsed') throw new Error('expected parsed');
    expect(result.branchId).toBeTruthy();
    expect(result.stats.candidates).toBeGreaterThan(0);

    // §12: progress moves extract -> write, and nothing before write ever
    // reaches the RPC (job-level retry only — see this module's own comment).
    expect(calls.beginAttempt).toHaveLength(1);
    expect(calls.beginAttempt[0]?.stage).toBe('extract');
    expect(calls.setProgress).toHaveLength(1);
    expect(calls.setProgress[0]?.stage).toBe('write');
    expect(calls.setError).toEqual([]);

    expect(calls.writeCaptureDraft).toHaveLength(1);
    const written = calls.writeCaptureDraft[0];
    expect(written?.jobId).toBe(PENDING_JOB.id);
    expect(written?.deltas.length).toBeGreaterThan(0);
    expect(written?.candidates.length).toBeGreaterThan(0);
    expect(written?.commitBody).toMatch(/candidates/);
  });

  it('reads reimportPrevious only when the job names a previous run', async () => {
    const { deps } = fakeDeps();
    await runCaptureRunStep(deps, PENDING_JOB.id);
    expect(deps.readReimportPrevious).not.toHaveBeenCalled();

    const { deps: deps2 } = fakeDeps({ job: { ...PENDING_JOB, reimportOfJobId: 'job-0' } });
    await runCaptureRunStep(deps2, PENDING_JOB.id);
    expect(deps2.readReimportPrevious).toHaveBeenCalledWith('job-0');
  });

  it('fails cleanly (no write) for a named RunCaptureFailure, e.g. no usable sheet', async () => {
    const { deps, calls } = fakeDeps({ source: { format: 'csv', text: '\n\n\n' } });
    const result = await runCaptureRunStep(deps, PENDING_JOB.id);

    expect(result).toEqual({ status: 'failed', error: { code: 'NO_USABLE_SHEET', message: expect.stringContaining('header') } });
    expect(calls.setError).toHaveLength(1);
    expect(deps.writeCaptureDraft).not.toHaveBeenCalled();
  });

  it('classifies a coded LLM error (§11) by its own .code, e.g. LLM_REFUSAL', async () => {
    const refusingLlm: LlmClient = {
      complete() {
        throw new LlmRefusalError();
      },
    };
    // An unmapped header forces a real prompt-A call.
    const { deps, calls } = fakeDeps({ llmClient: refusingLlm, source: { format: 'csv', text: ['Application,Supplier,Mystery Column', 'CRM,Acme,???'].join('\n') } });
    const result = await runCaptureRunStep(deps, PENDING_JOB.id);
    expect(result).toEqual({ status: 'failed', error: { code: 'LLM_REFUSAL', message: expect.any(String) } });
    expect(calls.setError).toEqual([{ code: 'LLM_REFUSAL', message: expect.any(String) }]);
  });

  it('falls back to a disclosed catch-all code for an unexpected, uncoded error', async () => {
    const brokenLlm: LlmClient = {
      complete() {
        throw new Error('socket hang up');
      },
    };
    const { deps } = fakeDeps({ llmClient: brokenLlm, source: { format: 'csv', text: ['Application,Supplier,Mystery Column', 'CRM,Acme,???'].join('\n') } });
    const result = await runCaptureRunStep(deps, PENDING_JOB.id);
    expect(result).toEqual({ status: 'failed', error: { code: 'CAPTURE_RUN_FAILED', message: 'socket hang up' } });
  });

  it('maps a proxy 503 message to LLM_UNAVAILABLE (§11)', async () => {
    const unavailableLlm: LlmClient = {
      complete() {
        throw new Error('llm-proxy call failed (503): Service Unavailable');
      },
    };
    const { deps } = fakeDeps({ llmClient: unavailableLlm, source: { format: 'csv', text: ['Application,Supplier,Mystery Column', 'CRM,Acme,???'].join('\n') } });
    const result = await runCaptureRunStep(deps, PENDING_JOB.id);
    expect(result).toEqual({ status: 'failed', error: { code: 'LLM_UNAVAILABLE', message: expect.any(String) } });
  });

  it('a retried attempt (still pending after a failed one) reruns the whole pipeline from scratch and can succeed', async () => {
    const { deps, calls } = fakeDeps({ source: { format: 'csv', text: '\n\n\n' } });
    const first = await runCaptureRunStep(deps, PENDING_JOB.id);
    expect(first).toMatchObject({ status: 'failed' });
    expect(calls.setError).toHaveLength(1);

    // The job is still `pending` (a failure never advances `status`) — swap
    // in a real sheet and invoke again with the same jobId, exactly what a
    // client-side retry does.
    deps.downloadInput = vi.fn(() => Promise.resolve({ format: 'csv' as const, text: ['Application,Supplier,Status', 'CRM,Acme,Live'].join('\n') }));
    const second = await runCaptureRunStep(deps, PENDING_JOB.id);

    expect(second.status).toBe('parsed');
    expect(calls.beginAttempt).toHaveLength(2); // once per attempt — the second call's own beginAttempt is what clears the first attempt's stale error in a real implementation.
    expect(deps.writeCaptureDraft).toHaveBeenCalledTimes(1);
  });

  it('drops a candidate whose delta the engine rejects, keeping the rest of the run', async () => {
    const text = 'CRM uses Billing.';
    const location: PromptBChunkLocation = { kind: 'pastedText', start: 0, end: text.length, total: text.length };
    const userMessage = buildPromptBUserMessage({ inputName: PENDING_JOB.inputName, location, chunkText: text });
    const request: LlmRequest = { effort: 'medium', system: PROMPT_B_SYSTEM, format: { type: 'json_schema', schema: PROMPT_B_SCHEMA }, messages: [{ role: 'user', content: userMessage }] };
    const key = hashLlmRequest(request);
    const responseBody = {
      elements: [
        { elementType: 'system', name: 'CRM', namePassage: 'CRM', nameConfidence: 0.9, parentName: null, attributes: [] },
        { elementType: 'system', name: 'Billing', namePassage: 'Billing', nameConfidence: 0.9, parentName: null, attributes: [] },
      ],
      // Two identical uses relationships — the second is a duplicate the
      // engine rejects (V6). One bad candidate must not fail the whole run.
      relationships: [
        { relationshipType: 'uses', fromName: 'CRM', toName: 'Billing', passage: 'CRM uses Billing', confidence: 0.9, attributes: [] },
        { relationshipType: 'uses', fromName: 'CRM', toName: 'Billing', passage: 'CRM uses Billing', confidence: 0.9, attributes: [] },
      ],
    };
    const llmClient = new RecordedLlmClient({ cassettes: new Map([[key, { text: JSON.stringify(responseBody), stopReason: 'end_turn', inputTokens: 10, outputTokens: 10, cacheReadTokens: 0 }]]) });

    const { deps, calls } = fakeDeps({ llmClient, source: { format: 'text' as const, text } });
    const result = await runCaptureRunStep(deps, PENDING_JOB.id);

    expect(result.status).toBe('parsed');
    expect(calls.writeCaptureDraft).toHaveLength(1);
    const written = calls.writeCaptureDraft[0];
    const relationshipCandidates = written?.candidates.filter((c) => c.kind === 'relationship') ?? [];
    expect(relationshipCandidates).toHaveLength(2);
    expect(relationshipCandidates.filter((c) => c.class === 'new')).toHaveLength(1);
    expect(relationshipCandidates.filter((c) => c.class === 'invalid')).toHaveLength(1);
    // The kept relationship's delta survives; the dropped one's does not.
    expect(written?.deltas.filter((d) => d.kind === 'relationship_create')).toHaveLength(1);
  });
});
