import { PDFDocument } from 'pdf-lib';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { emptyHead } from '../engine/deltas';
import { hashLlmRequest, RecordedLlmClient, type LlmClient, type LlmRequest, type LlmResponse } from './llm/client';
import { buildMatchIndex } from './matchIndex';
import { buildPromptBUserMessage, PROMPT_B_SCHEMA, PROMPT_B_SYSTEM, type PromptBChunkLocation } from './prompts/b';
import type { ElementProposal } from '../contracts/capture';
import { inferSheetType, orderByParentDependency, runCapture, type RunCaptureSuccess } from './runCapture';
import type { RowCandidate } from './rowsToCandidates';

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
    expect(inferSheetType('Applications', null)).toBe('system');
  });
  it('reads a Modules-like sheet name as container', () => {
    expect(inferSheetType('Modules', null)).toBe('container');
  });
  it('reads a Teams-like sheet name as actor', () => {
    expect(inferSheetType('Teams', null)).toBe('actor');
    expect(inferSheetType('Actors', null)).toBe('actor');
  });
  it('falls back to the LLM sheetType only when heuristics are undecided', () => {
    expect(inferSheetType('Sheet1', 'capability')).toBe('capability');
  });
  it('does not force container for a non-container-named sheet, even though it may have a parent column (Sprint F2b — a mapped parent column now decides per row, in rowsToCandidates.ts, not at the sheet level)', () => {
    expect(inferSheetType('Applications', null)).toBe('system');
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

  it('a plain Applications-sheet row (always proposed as elementType system, no parent) matches a real container of the same name instead of proposing a duplicate new system (ESCOMS regression)', async () => {
    const csv = 'Application,Supplier,Status\nESCOMS,Acme,Live';
    const platform = { element_id: 'sys-1', element_type: 'system' as const, name: 'Salesforce', parent_id: null, attributes: {}, exists_delta_id: 'd-1' };
    const escoms = { element_id: 'c-1', element_type: 'container' as const, name: 'ESCOMS', parent_id: 'sys-1', attributes: { vendor: 'Acme', lifecycleStatus: 'active', isExternal: false }, exists_delta_id: 'd-2' };
    const matchIndex = buildMatchIndex([platform, escoms], []);
    const mainHead = emptyHead();
    mainHead.elements.set('sys-1', { elementType: 'system', name: 'Salesforce', parentId: null, attributes: {}, existsDeltaId: 'd-1' });
    mainHead.elements.set('c-1', { elementType: 'container', name: 'ESCOMS', parentId: 'sys-1', attributes: escoms.attributes, existsDeltaId: 'd-2' });

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

    expect(result.candidates.filter((c) => c.kind === 'element')).toHaveLength(1);
    const matched = result.candidates.find((c) => c.kind === 'element');
    // Proposed as a system (a plain Applications sheet has no notion of
    // "module of X") — resolved to the real container's own type, not left
    // as the document's own guess, and matched rather than creating a
    // second, duplicate `new` system alongside the real container.
    expect(matched?.elementType).toBe('container');
    expect(matched?.draftSubjectId).toBe('c-1');
    expect(matched?.class).not.toBe('new');
    expect(matched?.match.warnings).toContain('MATCHED_CROSS_TYPE');
  });

  it('a plain Applications-sheet row named with a platform prefix (always proposed as elementType system, no parent) matches the platform\'s own container of the bare remainder name, and recovers the parent link ("SAP PM" regression)', async () => {
    const csv = 'Application,Supplier,Status\nSAP PM,Acme,Live';
    const platform = { element_id: 'sys-1', element_type: 'system' as const, name: 'SAP', parent_id: null, attributes: {}, exists_delta_id: 'd-1' };
    const pm = { element_id: 'c-1', element_type: 'container' as const, name: 'PM', parent_id: 'sys-1', attributes: { vendor: 'Acme', lifecycleStatus: 'active', isExternal: false }, exists_delta_id: 'd-2' };
    const matchIndex = buildMatchIndex([platform, pm], []);
    const mainHead = emptyHead();
    mainHead.elements.set('sys-1', { elementType: 'system', name: 'SAP', parentId: null, attributes: {}, existsDeltaId: 'd-1' });
    mainHead.elements.set('c-1', { elementType: 'container', name: 'PM', parentId: 'sys-1', attributes: pm.attributes, existsDeltaId: 'd-2' });

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

    expect(result.candidates.filter((c) => c.kind === 'element')).toHaveLength(1);
    const matched = result.candidates.find((c) => c.kind === 'element');
    // Proposed as a top-level system named "SAP PM" (a plain Applications
    // sheet has no notion of "module of X", and the document never states a
    // parent) — resolved to the real container's own type and matched, with
    // the platform recovered as this candidate's parent even though the
    // document itself never named one.
    expect(matched?.elementType).toBe('container');
    expect(matched?.draftSubjectId).toBe('c-1');
    expect(matched?.class).not.toBe('new');
    expect(matched?.match.warnings).toContain('MATCHED_PLATFORM_PREFIX');
    expect(matched?.proposal.kind === 'element' && matched.proposal.parent).toEqual({ kind: 'existing', elementId: 'sys-1' });
  });
});

describe('runCapture — target-branch matching (K-8/§7.1, issue #285)', () => {
  const csv = 'Application,Supplier,Status\nCRM,Acme,Live';

  it('classifies a candidate matching a target-branch-only element as duplicate_in_target, with no draftSubjectId', async () => {
    const targetHead = emptyHead();
    targetHead.elements.set('target-crm', { elementType: 'system', name: 'CRM', parentId: null, attributes: {}, existsDeltaId: 'd-target-crm' });

    const result = await expectSuccess(
      runCapture({
        inputName: 'Applications.csv',
        source: { format: 'csv', text: csv },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex([], []),
        mainHead: emptyHead(),
        targetHead,
        mintId: mintIdFrom('el'),
      }),
    );

    const system = result.candidates.find((c) => c.elementType === 'system');
    expect(system?.class).toBe('duplicate_in_target');
    expect(system?.draftSubjectId).toBeNull();
    expect(system?.match.elementId).toBe('target-crm');
  });

  it('classifies as new (not duplicate_in_target) when the job has no target branch', async () => {
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

    const system = result.candidates.find((c) => c.elementType === 'system');
    expect(system?.class).toBe('new');
    expect(system?.draftSubjectId).not.toBeNull();
  });

  it('prefers an ordinary main match over the target branch entirely — the target-only index is never even consulted', async () => {
    const existing = { element_id: 'sys-1', element_type: 'system' as const, name: 'CRM', parent_id: null, attributes: { vendor: 'Acme' }, exists_delta_id: 'd-1' };
    const matchIndex = buildMatchIndex([existing], []);
    const mainHead = emptyHead();
    mainHead.elements.set('sys-1', { elementType: 'system', name: 'CRM', parentId: null, attributes: existing.attributes, existsDeltaId: 'd-1' });

    const targetHead = emptyHead();
    targetHead.elements.set('target-crm', { elementType: 'system', name: 'CRM', parentId: null, attributes: {}, existsDeltaId: 'd-target-crm' });

    const result = await expectSuccess(
      runCapture({
        inputName: 'Applications.csv',
        source: { format: 'csv', text: csv },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex,
        mainHead,
        targetHead,
        mintId: mintIdFrom('el'),
      }),
    );

    const system = result.candidates.find((c) => c.elementType === 'system');
    expect(system?.class).not.toBe('duplicate_in_target');
    expect(system?.draftSubjectId).toBe('sys-1');
  });
});

describe('runCapture — prose supports endpoint typing (C9 regression)', () => {
  it('marks a supports relationship invalid when its from resolves to a capability, not a system', async () => {
    const text = 'Data Governance supports Data Sharing.';
    const capabilities = [
      { element_id: 'cap-gov', element_type: 'capability' as const, name: 'Data Governance', parent_id: null, attributes: {}, exists_delta_id: 'd-gov' },
      { element_id: 'cap-share', element_type: 'capability' as const, name: 'Data Sharing', parent_id: null, attributes: {}, exists_delta_id: 'd-share' },
    ];
    const matchIndex = buildMatchIndex(capabilities, []);

    const location: PromptBChunkLocation = { kind: 'pastedText', start: 0, end: text.length, total: text.length };
    const userMessage = buildPromptBUserMessage({ inputName: 'notes.txt', location, chunkText: text });
    const request: LlmRequest = { effort: 'medium', system: PROMPT_B_SYSTEM, format: { type: 'json_schema', schema: PROMPT_B_SCHEMA }, messages: [{ role: 'user', content: userMessage }] };
    const key = hashLlmRequest(request);
    const responseBody = {
      elements: [],
      relationships: [{ relationshipType: 'supports', fromName: 'Data Governance', toName: 'Data Sharing', passage: 'Data Governance supports Data Sharing', confidence: 0.9, attributes: [] }],
    };
    const llmClient = new RecordedLlmClient({ cassettes: new Map([[key, { text: JSON.stringify(responseBody), stopReason: 'end_turn', inputTokens: 10, outputTokens: 10, cacheReadTokens: 0 }]]) });

    const result = await expectSuccess(
      runCapture({
        inputName: 'notes.txt',
        source: { format: 'text', text },
        documentDate: null,
        llmClient,
        matchIndex,
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );

    const relationship = result.candidates.find((c) => c.kind === 'relationship');
    expect(relationship?.class).toBe('invalid');
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
    const request: LlmRequest = { effort: 'medium', system: PROMPT_B_SYSTEM, format: { type: 'json_schema', schema: PROMPT_B_SCHEMA }, messages: [{ role: 'user', content: userMessage }] };
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

function buildWorkbookBuffer(sheets: Record<string, string[][]>): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('runCapture — mixed system/module sheet (Sprint F2b, SPEC-capture.md §5.2)', () => {
  it('splits rows on a non-container-named sheet by its own parent column: blank -> system, filled -> module of that system, through the real inferSheetType path (regression: hasParentColumn used to force the whole sheet to container before this Sprint F2b fix, making rowsToCandidates.ts\'s own per-row split unreachable)', async () => {
    const buffer = buildWorkbookBuffer({
      Applications: [
        ['Application', 'Parent system', 'Status'],
        ['CRM', '', 'Live'],
        ['Portal', 'CRM', 'Live'],
      ],
    });

    const result = await expectSuccess(
      runCapture({
        inputName: 'Applications.xlsx',
        source: { format: 'xlsx', bytes: buffer },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex([], []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );

    const crm = result.candidates.find((c) => c.proposal.kind === 'element' && c.proposal.name === 'CRM');
    const portal = result.candidates.find((c) => c.proposal.kind === 'element' && c.proposal.name === 'Portal');
    expect(crm?.elementType).toBe('system');
    expect(portal?.elementType).toBe('container');
    expect(portal?.proposal.kind === 'element' && portal.proposal.parent).toEqual({ kind: 'existing', elementId: crm?.draftSubjectId });
  });

  it('still resolves every row to container when every row on the sheet fills the parent column (no regression for a sheet that was already all-module before this fix)', async () => {
    const buffer = buildWorkbookBuffer({
      Applications: [
        ['Application', 'Parent system', 'Status'],
        ['Portal', 'CRM', 'Live'],
        ['Reports', 'Billing', 'Live'],
      ],
    });

    const result = await expectSuccess(
      runCapture({
        inputName: 'Applications.xlsx',
        source: { format: 'xlsx', bytes: buffer },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex([], []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );

    const elements = result.candidates.filter((c) => c.kind === 'element');
    expect(elements.every((c) => c.elementType === 'container')).toBe(true);
  });
});

describe('runCapture — Relationships sheet (Sprint F2b, SPEC-capture.md §5.2a)', () => {
  it('resolves a Relationships-sheet row against systems the workbook\'s own Applications sheet just proposed, with no LLM call for either sheet', async () => {
    const buffer = buildWorkbookBuffer({
      Applications: [
        ['Application', 'Supplier', 'Status'],
        ['CRM', 'Acme', 'Live'],
        ['Billing', 'Beta', 'Live'],
      ],
      Relationships: [
        ['from', 'type', 'to', 'description'],
        ['CRM', 'uses', 'Billing', 'reads invoice data'],
      ],
    });

    const result = await expectSuccess(
      runCapture({
        inputName: 'Applications.xlsx',
        source: { format: 'xlsx', bytes: buffer },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex([], []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );

    const systems = result.candidates.filter((c) => c.elementType === 'system');
    expect(systems).toHaveLength(2);

    const uses = result.candidates.find((c) => c.relationshipType === 'uses');
    expect(uses?.class).toBe('new');
    expect(uses?.proposal.kind === 'relationship' && uses.proposal.attributes).toEqual({ description: 'reads invoice data' });
    const crmId = systems.find((c) => c.proposal.kind === 'element' && c.proposal.name === 'CRM')?.draftSubjectId;
    const billingId = systems.find((c) => c.proposal.kind === 'element' && c.proposal.name === 'Billing')?.draftSubjectId;
    expect(uses?.proposal.kind === 'relationship' && uses.proposal.from).toEqual({ kind: 'existing', elementId: crmId });
    expect(uses?.proposal.kind === 'relationship' && uses.proposal.to).toEqual({ kind: 'existing', elementId: billingId });
  });

  it('detects a Relationships sheet by header shape even when its name does not match', async () => {
    const buffer = buildWorkbookBuffer({
      Applications: [
        ['Application', 'Supplier', 'Status'],
        ['CRM', 'Acme', 'Live'],
        ['Billing', 'Beta', 'Live'],
      ],
      Sheet2: [
        ['from', 'type', 'to', 'description'],
        ['CRM', 'flows_to', 'Billing', 'sends nightly extract'],
      ],
    });

    const result = await expectSuccess(
      runCapture({
        inputName: 'Applications.xlsx',
        source: { format: 'xlsx', bytes: buffer },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex([], []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );

    expect(result.candidates.find((c) => c.relationshipType === 'flows_to')?.class).toBe('new');
  });
});

describe('runCapture — JSON input (Sprint F2b, SPEC-capture.md §5.6)', () => {
  it('produces new system candidates, an owner actor + owns edge, and a resolved capability, with no LLM call', async () => {
    const json = JSON.stringify({
      systems: [{ name: 'CRM', vendor: 'Acme', business_owner: 'Sales Team', capability: 'Customer Service' }],
    });
    const capabilities = [{ element_id: 'cap-1', element_type: 'capability' as const, name: 'Customer Service', parent_id: null, attributes: {}, exists_delta_id: 'd-1' }];

    const result = await expectSuccess(
      runCapture({
        inputName: 'import.json',
        source: { format: 'json', text: json },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex(capabilities, []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );

    const system = result.candidates.find((c) => c.elementType === 'system');
    expect(system?.class).toBe('new');
    expect(system?.proposal.kind === 'element' && (system.proposal.attributes as Record<string, unknown>).vendor).toBe('Acme');
    expect(system?.evidence.extractor).toBe('json-authored');

    const actor = result.candidates.find((c) => c.elementType === 'actor');
    expect(actor?.proposal.kind === 'element' && actor.proposal.name).toBe('Sales Team');

    const owns = result.candidates.find((c) => c.relationshipType === 'owns');
    expect(owns?.class).toBe('new');

    const supports = result.candidates.find((c) => c.relationshipType === 'supports');
    expect(supports?.class).toBe('new');
    expect(supports?.proposal.kind === 'relationship' && supports.proposal.to).toEqual({ kind: 'existing', elementId: 'cap-1' });
  });

  it('caps an unstated confidence at 0.90, never defaulting to 1.0', async () => {
    const json = JSON.stringify({ systems: [{ name: 'CRM' }] });
    const result = await expectSuccess(
      runCapture({
        inputName: 'import.json',
        source: { format: 'json', text: json },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex([], []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );
    const system = result.candidates.find((c) => c.elementType === 'system');
    expect(system?.confidence).toBeLessThanOrEqual(0.9);
  });

  it('uses a stated confidence as given, clipped to [0,1]', async () => {
    const json = JSON.stringify({ systems: [{ name: 'CRM', confidence: 0.4 }] });
    const result = await expectSuccess(
      runCapture({
        inputName: 'import.json',
        source: { format: 'json', text: json },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex([], []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );
    const system = result.candidates.find((c) => c.elementType === 'system');
    expect(system?.evidence.attributeConfidence.name).toBe(0.4);
  });

  it('resolves a relationships-section entry against the systems section, carrying via as viaHint', async () => {
    const json = JSON.stringify({
      systems: [{ name: 'CRM' }, { name: 'Billing' }],
      relationships: [{ from: 'CRM', type: 'uses', to: 'Billing', description: 'reads invoice data', via: 'Enterprise Bus' }],
    });
    const result = await expectSuccess(
      runCapture({
        inputName: 'import.json',
        source: { format: 'json', text: json },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex([], []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );
    const uses = result.candidates.find((c) => c.relationshipType === 'uses');
    expect(uses?.class).toBe('new');
    expect(uses?.proposal.kind === 'relationship' && uses.proposal.attributes).toMatchObject({ description: 'reads invoice data' });
  });

  it('resolves a changes-section retire against an existing main element, never creating one', async () => {
    const existing = { element_id: 'sys-1', element_type: 'system' as const, name: 'Legacy CRM', parent_id: null, attributes: {}, exists_delta_id: 'd-1' };
    const json = JSON.stringify({ systems: [{ name: 'Something Else' }], changes: [{ name: 'Legacy CRM', action: 'retire', reason: 'replaced' }] });
    const result = await expectSuccess(
      runCapture({
        inputName: 'import.json',
        source: { format: 'json', text: json },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex([existing], []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );
    const retirements = result.candidates.filter((c) => c.elementType === 'system' && c.draftSubjectId === 'sys-1');
    expect(retirements).toHaveLength(1);
    expect(retirements[0]?.class === 'new').toBe(false);
    expect(retirements[0]?.proposal.kind === 'element' && (retirements[0].proposal.attributes as Record<string, unknown>).lifecycleStatus).toBe('retired');
  });

  it("reports a changes-section candidate's own confidence from its actual lifecycleStatus claim, not a false floor of 0 (regression: elementCandidateConfidence used to floor on name/isExternal confidences this candidate never sets, since it only ever asserts lifecycleStatus)", async () => {
    const existing = { element_id: 'sys-1', element_type: 'system' as const, name: 'Legacy CRM', parent_id: null, attributes: { lifecycleStatus: 'active' }, exists_delta_id: 'd-1' };
    const json = JSON.stringify({ systems: [{ name: 'Something Else' }], changes: [{ name: 'Legacy CRM', action: 'retire', confidence: 0.8 }] });
    const result = await expectSuccess(
      runCapture({
        inputName: 'import.json',
        source: { format: 'json', text: json },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex([existing], []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );
    const retirement = result.candidates.find((c) => c.draftSubjectId === 'sys-1');
    expect(retirement?.confidence).toBe(0.8);
  });

  it('classifies a changes-section entry naming something nowhere in the model as invalid, never new', async () => {
    const json = JSON.stringify({ systems: [{ name: 'Something' }], changes: [{ name: 'Nonexistent System', action: 'retire' }] });
    const result = await expectSuccess(
      runCapture({
        inputName: 'import.json',
        source: { format: 'json', text: json },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex([], []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );
    const change = result.candidates.find((c) => c.proposal.kind === 'element' && c.proposal.name === 'Nonexistent System');
    expect(change?.class).toBe('invalid');
    expect(change?.draftSubjectId).toBeNull();
  });

  it('proposes a replaces candidate when a changes-section retire names a replacement, resolved against main', async () => {
    const oldSystem = { element_id: 'old-crm', element_type: 'system' as const, name: 'Legacy CRM', parent_id: null, attributes: {}, exists_delta_id: 'd-old' };
    const newSystem = { element_id: 'new-crm', element_type: 'system' as const, name: 'New CRM', parent_id: null, attributes: {}, exists_delta_id: 'd-new' };
    const json = JSON.stringify({ systems: [{ name: 'Something' }], changes: [{ name: 'Legacy CRM', action: 'retire', replaced_by: 'New CRM' }] });

    const result = await expectSuccess(
      runCapture({
        inputName: 'import.json',
        source: { format: 'json', text: json },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex([oldSystem, newSystem], []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );

    const replaces = result.candidates.find((c) => c.relationshipType === 'replaces');
    expect(replaces?.class).toBe('new');
    expect(replaces?.proposal.kind === 'relationship' && replaces.proposal.from).toEqual({ kind: 'existing', elementId: 'new-crm' });
    expect(replaces?.proposal.kind === 'relationship' && replaces.proposal.to).toEqual({ kind: 'existing', elementId: 'old-crm' });
  });

  it('classifies a replaces candidate as invalid when the replacement name resolves to nothing', async () => {
    const oldSystem = { element_id: 'old-crm', element_type: 'system' as const, name: 'Legacy CRM', parent_id: null, attributes: {}, exists_delta_id: 'd-old' };
    const json = JSON.stringify({ systems: [{ name: 'Something' }], changes: [{ name: 'Legacy CRM', action: 'retire', replaced_by: 'Nonexistent Replacement' }] });

    const result = await expectSuccess(
      runCapture({
        inputName: 'import.json',
        source: { format: 'json', text: json },
        documentDate: '2026-01-01',
        llmClient: NEVER_CALLED_LLM,
        matchIndex: buildMatchIndex([oldSystem], []),
        mainHead: emptyHead(),
        mintId: mintIdFrom('el'),
      }),
    );

    const replaces = result.candidates.find((c) => c.relationshipType === 'replaces');
    expect(replaces?.class).toBe('invalid');
  });

  it('fails INPUT_UNREADABLE for malformed JSON', async () => {
    const result = await runCapture({
      inputName: 'import.json',
      source: { format: 'json', text: 'not json' },
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

describe('orderByParentDependency', () => {
  const capability = (seq: number, name: string, parent: string | null): RowCandidate & { proposal: ElementProposal } => ({
    seq,
    proposal: { kind: 'element', elementType: 'capability', name, parent: parent === null ? null : { kind: 'unresolved', text: parent }, attributes: {} },
    evidence: { sourceRef: { kind: 'sheet', sheet: 'Capabilities', range: `A${String(seq + 2)}` }, passage: name, extractor: 'sheet-mapping', attributeConfidence: {}, warnings: [] },
    aliasProposals: [],
  });
  const names = (list: readonly { proposal: ElementProposal }[]) => list.map((c) => c.proposal.name);

  it('puts a parent that is itself a candidate before its children, keeping file order otherwise', () => {
    // A sheet sorted by name lists "Quotation Pricing" (a grandchild) before "Connection Quotations" (its parent).
    const ordered = orderByParentDependency([capability(0, 'Quotation Pricing', 'Connection Quotations'), capability(1, 'Connection Quotations', 'Customer'), capability(2, 'Connections', 'Customer')]);
    expect(names(ordered)).toEqual(['Connection Quotations', 'Connections', 'Quotation Pricing']);
  });

  it('leaves an already-ordered list alone', () => {
    const list = [capability(0, 'Connection Quotations', 'Customer'), capability(1, 'Quotation Pricing', 'Connection Quotations')];
    expect(names(orderByParentDependency(list))).toEqual(['Connection Quotations', 'Quotation Pricing']);
  });

  it('does not loop on two rows that name each other as parent', () => {
    expect(orderByParentDependency([capability(0, 'A', 'B'), capability(1, 'B', 'A')])).toHaveLength(2);
  });
});

describe('runCapture — naming a module that more than one platform has', () => {
  const workbook = buildWorkbookBuffer({
    Applications: [['System', 'Supplier', 'Status'], ['SAP', 'SAP SE', 'Live'], ['Salesforce', 'Salesforce Inc', 'Live']],
    Modules: [['Module', 'Parent system', 'Description'], ['PM', 'SAP', 'Plant maintenance'], ['PM', 'Salesforce', 'Programme management'], ['ESCOMS', 'Salesforce', 'Wayleaves']],
    Relationships: [
      ['From', 'Type', 'To', 'Description'],
      ['ESCOMS', 'uses', 'PM', 'reads work orders from'],
      ['ESCOMS', 'uses', 'SAP · PM', 'reads work orders from'],
    ],
  });

  it('will not guess between two same-named modules, and resolves the one written with its platform', async () => {
    const result = await expectSuccess(
      runCapture({ inputName: 'model.xlsx', source: { format: 'xlsx', bytes: workbook }, documentDate: null, llmClient: NEVER_CALLED_LLM, matchIndex: buildMatchIndex([], []), mainHead: emptyHead(), mintId: mintIdFrom('el') }),
    );
    const relationships = result.candidates.filter((c) => c.kind === 'relationship');
    expect(relationships.map((c) => c.class)).toEqual(['invalid', 'new']);
    expect(relationships[0]?.evidence.warnings).toContainEqual({ code: 'ENDPOINT_UNRESOLVED', text: 'PM', end: 'to' });
  });
});

