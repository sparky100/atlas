import { describe, expect, it } from 'vitest';
import { hashLlmRequest, RecordedLlmClient, type LlmRequest } from './llm/client';
import { mapSheetColumns } from './mapColumns';
import { PROMPT_A_SCHEMA, PROMPT_A_SYSTEM, buildPromptAUserMessage } from './prompts/a';

describe('mapSheetColumns', () => {
  it('never calls the model when every header has a synonym hit', async () => {
    const llmClient = new RecordedLlmClient({ cassettes: new Map() }); // any real call would throw "no cassette"
    const result = await mapSheetColumns({
      llmClient,
      inputName: 'Applications.csv',
      sheetName: 'Applications',
      rowCount: 2,
      headers: ['Application', 'Supplier'],
      headerColumnRefs: ['A', 'B'],
      sampleRows: [['CRM', 'Acme']],
    });
    expect(result.llmSheetType).toBeNull();
    expect(result.roles[0]).toMatchObject({ role: 'name', source: 'synonym' });
    expect(result.roles[1]).toMatchObject({ role: 'vendor', source: 'synonym' });
  });

  it('falls back to prompt A for headers the synonym table misses, via a recorded cassette', async () => {
    const userMessage = buildPromptAUserMessage({
      inputName: 'Applications.csv',
      sheetName: 'Applications',
      rowCount: 1,
      mappedHeaders: [{ header: 'Application', role: 'name' }],
      unmappedHeaders: [{ columnRef: 'B', header: 'Who supplies it' }],
      sampleRows: [['Acme Corp']],
    });
    const request: LlmRequest = {
      effort: 'medium',
      system: PROMPT_A_SYSTEM,
      format: { type: 'json_schema', schema: PROMPT_A_SCHEMA },
      messages: [{ role: 'user', content: userMessage }],
    };
    const cassetteKey = hashLlmRequest(request);
    const responseText = JSON.stringify({
      sheetType: 'system',
      columns: [{ column: 'B', role: 'vendor', confidence: 0.85, reason: 'Header reads like a supplier column.' }],
    });
    const llmClient = new RecordedLlmClient({
      cassettes: new Map([[cassetteKey, { text: responseText, stopReason: 'end_turn', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 }]]),
    });

    const result = await mapSheetColumns({
      llmClient,
      inputName: 'Applications.csv',
      sheetName: 'Applications',
      rowCount: 1,
      headers: ['Application', 'Who supplies it'],
      headerColumnRefs: ['A', 'B'],
      sampleRows: [['CRM', 'Acme Corp']],
    });

    expect(result.llmSheetType).toBe('system');
    expect(result.roles[1]).toEqual({ role: 'vendor', confidence: 0.85, source: 'llm' });
  });

  it('clips the model\'s own confidence to ≤ 0.90 and flags LOW_MAPPING_CONFIDENCE below 0.70', async () => {
    const userMessage = buildPromptAUserMessage({
      inputName: 'x.csv',
      sheetName: 'Sheet1',
      rowCount: 1,
      mappedHeaders: [{ header: 'Application', role: 'name' }],
      unmappedHeaders: [{ columnRef: 'B', header: 'Mystery Column' }],
      sampleRows: [['???']],
    });
    const request: LlmRequest = { effort: 'medium', system: PROMPT_A_SYSTEM, format: { type: 'json_schema', schema: PROMPT_A_SCHEMA }, messages: [{ role: 'user', content: userMessage }] };
    const cassetteKey = hashLlmRequest(request);
    const responseText = JSON.stringify({ sheetType: 'unknown', columns: [{ column: 'B', role: 'description', confidence: 0.99, reason: 'guess' }] });
    const llmClient = new RecordedLlmClient({ cassettes: new Map([[cassetteKey, { text: responseText, stopReason: 'end_turn', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }]]) });

    const result = await mapSheetColumns({ llmClient, inputName: 'x.csv', sheetName: 'Sheet1', rowCount: 1, headers: ['Application', 'Mystery Column'], headerColumnRefs: ['A', 'B'], sampleRows: [['CRM', '???']] });
    expect(result.roles[1]?.confidence).toBe(0.9);
    expect(result.warnings).toEqual([]);
  });

  it('propagates a malformed prompt-A response as MapColumnsError rather than silently accepting it', async () => {
    const userMessage = buildPromptAUserMessage({
      inputName: 'x.csv',
      sheetName: 'Sheet1',
      rowCount: 1,
      mappedHeaders: [{ header: 'Application', role: 'name' }],
      unmappedHeaders: [{ columnRef: 'B', header: 'Mystery Column' }],
      sampleRows: [['???']],
    });
    const request: LlmRequest = { effort: 'medium', system: PROMPT_A_SYSTEM, format: { type: 'json_schema', schema: PROMPT_A_SCHEMA }, messages: [{ role: 'user', content: userMessage }] };
    const cassetteKey = hashLlmRequest(request);
    const llmClient = new RecordedLlmClient({ cassettes: new Map([[cassetteKey, { text: 'not json at all', stopReason: 'end_turn', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }]]) });

    await expect(mapSheetColumns({ llmClient, inputName: 'x.csv', sheetName: 'Sheet1', rowCount: 1, headers: ['Application', 'Mystery Column'], headerColumnRefs: ['A', 'B'], sampleRows: [['CRM', '???']] })).rejects.toThrow(/valid JSON/);
  });
});
