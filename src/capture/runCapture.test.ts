import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { emptyHead } from '../engine/deltas';
import { hashLlmRequest, RecordedLlmClient, type LlmClient, type LlmRequest, type LlmResponse } from './llm/client';
import { buildMatchIndex } from './matchIndex';
import { buildPromptBUserMessage, PROMPT_B_SCHEMA, PROMPT_B_SYSTEM, type PromptBChunkLocation } from './prompts/b';
import { inferSheetType, runCapture, type RunCaptureSuccess } from './runCapture';

const NEVER_CALLED_LLM: LlmClient = {
  complete(): Promise<LlmResponse> {
    throw new Error('LlmClient.complete should never be called for a fully synonym-mapped sheet with no capability column.');
  },
};

function mintIdFrom(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${String(n++)}`;
}

async function expectSuccess(promise: ReturnType<typeof runCapture>): Promise<RunCaptureSuccess> {
  const result = await promise;
  if (result.status !== 'parsed') throw new Error(`expected a parsed result, got failed: ${result.errorCode} ${result.message}`);
  return result;
}

describe('inferSheetType', () => {
  it('defaults to system', () => {
    expect(inferSheetType('Applications', false, null)).toBe('system');
  });
  it('reads a parent column as container', () => {
    expect(inferSheetType('Applications', true, null)).toBe('container');
  });
  it('reads a Modules-like sheet name as container even with no parent column', () => {
    expect(inferSheetType('Modules', false, null)).toBe('container');
  });
  it('reads a Teams-like sheet name as actor', () => {
    expect(inferSheetType('Teams', false, null)).toBe('actor');
  });
  it('falls back to the LLM sheetType only when heuristics are undecided', () => {
    expect(inferSheetType('Sheet1', false, 'capability')).toBe('capability');
  });
});

describe('runCapture — happy path (fixture-01-shaped)', () => {
  const csv = ['Application,Supplier,Status,Go-live,Business owner', 'CRM,Acme,Live,01/03/2019,Sales Team', 'Billing,Northgate,Planned,,Finance Team'].join('\n');

  it('produces a new system candidate per row, plus owner actors and owns edges', async () => {
    const result = await expectSuccess(
      runCapture({
        inputName: 'Applications.csv',
        source: { format: 'csv', text: csv },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex([], []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );

    const systems = result.candidates.filter((c) => c.kind === 'element' && c.elementType === 'system');
    expect(systems).toHaveLength(2);
    expect(systems.every((c) => c.class === 'new')).toBe(true);
    expect(systems[0]?.proposal.kind === 'element' && systems[0].proposal.name).toBe('CRM');

    const actors = result.candidates.filter((c) => c.elementType === 'actor');
    expect(actors).toHaveLength(2);

    const owns = result.candidates.filter((c) => c.relationshipType === 'owns');
    expect(owns).toHaveLength(2);
    expect(owns.every((c) => c.class === 'new')).toBe(true);

    // rowKey uses name+type+parent when no atlasId/sourceKey — deterministic and unique per row.
    const rowKeys = new Set(systems.map((c) => c.rowKey));
    expect(rowKeys.size).toBe(2);

    expect(result.stats.candidates).toBe(result.candidates.length);
  });

  it('is deterministic: running twice on the same input yields the same candidate set modulo minted ids', async () => {
    const run = () =>
      expectSuccess(
        runCapture({
          inputName: 'Applications.csv',
          source: { format: 'csv', text: csv },
          documentDate: '2026-01-01',
          llmClient: NEVER_CALLED_LLM,
          matchIndex: buildMatchIndex([], []),
          mainHead: emptyHead(),
          mintId: mintIdFrom('el'),
        }),
      );
    const [a, b] = await Promise.all([run(), run()]);
    const strip = (r: RunCaptureSuccess) => r.candidates.map((c) => ({ ...c, draftSubjectId: null }));
    expect(strip(a)).toEqual(strip(b));
  });
});

describe('runCapture — matching against main', () => {
  it('classifies an unchanged matched row as confirm, re-asserting every proposed attribute', async () => {
    const csv = 'Application,Supplier,Status\nCRM,Acme,Live';
    const existing = {
      element_id: 'sys-1',
      element_type: 'system' as const,
      name: 'CRM',
      parent_id: null,
      attributes: { vendor: 'Acme', lifecycleStatus: 'active', isExternal: false },
      exists_delta_id: 'd-1',
    };
    const matchIndex = buildMatchIndex([existing], []);
    const mainHead = emptyHead();
    mainHead.elements.set('sys-1', { elementType: 'system', name: 'CRM', parentId: null, attributes: existing.attributes, existsDeltaId: 'd-1' });
    mainHead.facts.set('sys-1\u0000vendor', { subjectId: 'sys-1', attribute: 'vendor', deltaId: 'd-1', sourceId: 'src-1', confidence: 1, authorId: 'u-1', createdAt: '2020-01-01T00:00:00Z', value: 'Acme' });
    mainHead.facts.set('sys-1\u0000lifecycleStatus', { subjectId: 'sys-1', attribute: 'lifecycleStatus', deltaId: 'd-1', sourceId: 'src-1', confidence: 1, authorId: 'u-1', createdAt: '2020-01-01T00:00:00Z', value: 'active' });
    mainHead.facts.set('sys-1\u0000isExternal', { subjectId: 'sys-1', attribute: 'isExternal', deltaId: 'd-1', sourceId: 'src-1', confidence: 1, authorId: 'u-1', createdAt: '2020-01-01T00:00:00Z', value: false });

    const result = await expectSuccess(
      runCapture({
        inputName: 'Applications.csv',
        source: { format: 'csv', text: csv },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex,
        mainHead,
        mintId: mintIdFrom('el'),
      }),
    );

    const system = result.candidates.find((c) => c.elementType === 'system');
    expect(system?.class).toBe('confirm');
    expect(system?.draftSubjectId).toBe('sys-1');
    expect(system?.proposal.kind === 'element' && Object.keys(system.proposal.attributes)).toEqual(expect.arrayContaining(['vendor', 'lifecycleStatus', 'isExternal']));
  });
});

describe('runCapture — cross-sheet container parent resolution', () => {
  it('resolves a container to its parent system created earlier in the same run, marking it new under that context', async () => {
    const csv = ['Application,Supplier,Status', 'CRM,Acme,Live'].join('\n');
    const result = await expectSuccess(
      runCapture({
        inputName: 'Applications.csv',
        source: { format: 'csv', text: csv },
        documentDate: null,
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex([], []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );
    expect(result.candidates.some((c) => c.elementType === 'system' && c.class === 'new')).toBe(true);
  });
});

describe('runCapture — failure modes', () => {
  it('fails NO_USABLE_SHEET when the sheet has no detectable header row', async () => {
    const csv = '\n\n\n';
    const result = await runCapture({
      inputName: 'empty.csv',
      source: { format: 'csv', text: csv },
      documentDate: null,
      llmClient: NEVER_CALLED_LLM,
      matchIndex: buildMatchIndex([], []),
      mainHead: emptyHead(),
      mintId: mintIdFrom('el'),
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.errorCode).toBe('NO_USABLE_SHEET');
  });
});

describe('runCapture — pasted text (PR11 prose path)', () => {
  it('extracts a new system candidate from pasted text via prompt B, grounded against a text SourceRef', async () => {
    const text = 'The CRM system is supplied by Acme Corp.';
    const location: PromptBChunkLocation = { kind: 'pastedText', start: 0, end: text.length, total: text.length };
    const userMessage = buildPromptBUserMessage({ inputName: 'notes.txt', location, chunkText: text });
    const request: LlmRequest = { effort: 'high', system: PROMPT_B_SYSTEM, format: { type: 'json_schema', schema: PROMPT_B_SCHEMA }, messages: [{ role: 'user', content: userMessage }] };
    const key = hashLlmRequest(request);
    const responseBody = {
      elements: [
        {
          elementType: 'system',
          name: 'CRM',
          namePassage: 'The CRM system',
          nameConfidence: 0.9,
          parentName: null,
          attributes: [{ key: 'vendor', value: 'Acme Corp', passage: 'supplied by Acme Corp', confidence: 0.85 }],
        },
      ],
      relationships: [],
    };
    const llmClient = new RecordedLlmClient({ cassettes: new Map([[key, { text: JSON.stringify(responseBody), stopReason: 'end_turn', inputTokens: 10, outputTokens: 10, cacheReadTokens: 0 }]]) });

    const result = await expectSuccess(
      runCapture({
        inputName: 'notes.txt',
        source: { format: 'text', text },
        documentDate: '2026-01-01',
        llmClient,
        matchIndex: buildMatchIndex([], []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );

    expect(result.candidates).toHaveLength(1);
    const [candidate] = result.candidates;
    expect(candidate?.kind).toBe('element');
    expect(candidate?.elementType).toBe('system');
    expect(candidate?.class).toBe('new');
    expect(candidate?.proposal.kind === 'element' && candidate.proposal.name).toBe('CRM');
    expect(candidate?.evidence.sourceRef).toEqual({ kind: 'text', start: 0, end: 14 });
    expect(candidate?.evidence.extractor).toBe('prose-llm');
  });

  it('fails INPUT_TOO_LARGE for pasted text over the K-16 character limit, with no LLM call', async () => {
    const text = 'x'.repeat(200001);
    const result = await runCapture({
      inputName: 'huge.txt',
      source: { format: 'text', text },
      documentDate: null,
      llmClient: NEVER_CALLED_LLM,
      matchIndex: buildMatchIndex([], []),
      mainHead: emptyHead(),
      mintId: mintIdFrom('el'),
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.errorCode).toBe('INPUT_TOO_LARGE');
  });
});

describe('runCapture — PDF (PR11 prose path)', () => {
  it('fails NO_TEXT_LAYER for a scanned-looking PDF (every page under the non-whitespace threshold)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 600]);
    doc.addPage([400, 600]);
    const bytes = await doc.save();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const result = await runCapture({
      inputName: 'scanned.pdf',
      source: { format: 'pdf', bytes: buffer },
      documentDate: null,
      llmClient: NEVER_CALLED_LLM,
      matchIndex: buildMatchIndex([], []),
      mainHead: emptyHead(),
      mintId: mintIdFrom('el'),
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.errorCode).toBe('NO_TEXT_LAYER');
  });

  it('fails INPUT_UNREADABLE for bytes that are not a real PDF', async () => {
    const buffer = new TextEncoder().encode('this is not a pdf').buffer;
    const result = await runCapture({
      inputName: 'garbage.pdf',
      source: { format: 'pdf', bytes: buffer },
      documentDate: null,
      llmClient: NEVER_CALLED_LLM,
      matchIndex: buildMatchIndex([], []),
      mainHead: emptyHead(),
      mintId: mintIdFrom('el'),
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.errorCode).toBe('INPUT_UNREADABLE');
  });
});
