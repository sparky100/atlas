import { describe, expect, it } from 'vitest';
import type { ElementProposal, RelationshipProposal } from '../contracts/capture';
import type { SourceRef } from '../contracts/sourceRef';
import { extractProseChunk, ExtractProseError } from './extractProse';
import { hashLlmRequest, RecordedLlmClient, type LlmRequest } from './llm/client';
import { buildPromptBUserMessage, PROMPT_B_SCHEMA, PROMPT_B_SYSTEM, type PromptBChunkLocation } from './prompts/b';

const LOCATION: PromptBChunkLocation = { kind: 'pastedText', start: 0, end: 100, total: 100 };

/** A stub translation that mirrors `TextChunk`'s own absolute-offset shape (`runCapture.ts`'s own `textChunkSourceRefFor` for a chunk starting at 0) — good enough to assert grounding actually located a real span, without pulling in `runCapture.ts`'s own PDF/text chunk types. */
function identitySourceRefForOffset(start: number, end: number): SourceRef {
  return { kind: 'text', start, end };
}

function llmClientFor(chunkText: string, priorElementNames: readonly string[], responseBody: unknown): RecordedLlmClient {
  const userMessage = buildPromptBUserMessage({ inputName: 'doc.txt', location: LOCATION, chunkText, ...(priorElementNames.length > 0 ? { priorElementNames } : {}) });
  const request: LlmRequest = { effort: 'medium', system: PROMPT_B_SYSTEM, format: { type: 'json_schema', schema: PROMPT_B_SCHEMA }, messages: [{ role: 'user', content: userMessage }] };
  const key = hashLlmRequest(request);
  return new RecordedLlmClient({ cassettes: new Map([[key, { text: JSON.stringify(responseBody), stopReason: 'end_turn', inputTokens: 10, outputTokens: 10, cacheReadTokens: 0 }]]) });
}

describe('extractProseChunk', () => {
  it('grounds an element and a relationship, applying §5.4 defaults and prose confidence', async () => {
    const chunkText = 'The CRM system is supplied by Acme Corp. The Sales team owns the CRM system.';
    const llmClient = llmClientFor(chunkText, [], {
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
      relationships: [{ relationshipType: 'owns', fromName: 'Sales team', toName: 'CRM', passage: 'The Sales team owns the CRM system', confidence: 0.8, attributes: [] }],
    });

    const { candidates, elementNames } = await extractProseChunk({ llmClient, inputName: 'doc.txt', location: LOCATION, chunkText, priorElementNames: [], sourceRefForOffset: identitySourceRefForOffset });

    expect(candidates).toHaveLength(2);
    expect(elementNames).toEqual(['CRM']);

    const [element, relationship] = candidates;
    expect(element?.proposal.kind).toBe('element');
    const elementProposal = element?.proposal as ElementProposal;
    expect(elementProposal.name).toBe('CRM');
    expect(elementProposal.parent).toBeNull();
    expect(elementProposal.attributes).toEqual({ vendor: 'Acme Corp', lifecycleStatus: 'active', isExternal: false });
    expect(element?.evidence.passage).toBe('The CRM system');
    expect(element?.evidence.sourceRef).toEqual({ kind: 'text', start: 0, end: 14 });
    expect(element?.evidence.attributeConfidence.name).toBeCloseTo(0.9);
    expect(element?.evidence.attributeConfidence.vendor).toBeCloseTo(0.85);
    expect(element?.evidence.attributeConfidence.lifecycleStatus).toBe(0.6);
    expect(element?.ungrounded).toBeUndefined();

    expect(relationship?.proposal.kind).toBe('relationship');
    const relationshipProposal = relationship?.proposal as RelationshipProposal;
    expect(relationshipProposal.relationshipType).toBe('owns');
    expect(relationshipProposal.from).toEqual({ kind: 'unresolved', text: 'Sales team' });
    expect(relationshipProposal.to).toEqual({ kind: 'unresolved', text: 'CRM' });
    expect(relationshipProposal.attributes).toEqual({ role: 'business' });
    expect(relationship?.evidence.attributeConfidence.role).toBe(0.6);
  });

  it('defaults supports.role to secondary when the model never supplies one', async () => {
    const chunkText = 'The Order Service supports Order Management.';
    const llmClient = llmClientFor(chunkText, [], {
      elements: [],
      relationships: [{ relationshipType: 'supports', fromName: 'Order Service', toName: 'Order Management', passage: 'The Order Service supports Order Management', confidence: 0.7, attributes: [] }],
    });

    const { candidates } = await extractProseChunk({ llmClient, inputName: 'doc.txt', location: LOCATION, chunkText, priorElementNames: [], sourceRefForOffset: identitySourceRefForOffset });
    const proposal = candidates[0]?.proposal as RelationshipProposal;
    expect(proposal.attributes).toEqual({ role: 'secondary' });
  });

  it('drops an attribute whose own passage cannot be grounded, without invalidating the rest of the candidate (PASSAGE_NOT_FOUND)', async () => {
    const chunkText = 'The Billing system is our finance application.';
    const llmClient = llmClientFor(chunkText, [], {
      elements: [
        {
          elementType: 'system',
          name: 'Billing',
          namePassage: 'The Billing system',
          nameConfidence: 0.9,
          parentName: null,
          attributes: [{ key: 'vendor', value: 'Acme', passage: 'a passage never in the source text', confidence: 0.8 }],
        },
      ],
      relationships: [],
    });

    const { candidates } = await extractProseChunk({ llmClient, inputName: 'doc.txt', location: LOCATION, chunkText, priorElementNames: [], sourceRefForOffset: identitySourceRefForOffset });
    const candidate = candidates[0];
    expect(candidate?.ungrounded).toBeUndefined();
    const proposal = candidate?.proposal as ElementProposal;
    expect((proposal.attributes as Record<string, unknown>).vendor).toBeUndefined();
    expect(candidate?.evidence.warnings).toContainEqual({ code: 'PASSAGE_NOT_FOUND', field: 'vendor' });
  });

  it('marks the whole candidate ungrounded when the element\'s own namePassage cannot be found, keeping the model\'s claimed text as evidence.passage', async () => {
    const chunkText = 'This document says nothing about that system at all.';
    const llmClient = llmClientFor(chunkText, [], {
      elements: [{ elementType: 'system', name: 'Ghost System', namePassage: 'the Ghost System is critical', nameConfidence: 0.8, parentName: null, attributes: [] }],
      relationships: [],
    });

    const { candidates, elementNames } = await extractProseChunk({ llmClient, inputName: 'doc.txt', location: LOCATION, chunkText, priorElementNames: [], sourceRefForOffset: identitySourceRefForOffset });
    const candidate = candidates[0];
    expect(candidate?.ungrounded).toBe(true);
    expect(candidate?.evidence.passage).toBe('the Ghost System is critical');
    expect(candidate?.evidence.warnings).toContainEqual({ code: 'PASSAGE_NOT_FOUND', field: 'name' });
    expect(elementNames).toEqual([]); // an ungrounded element's own name is never trustworthy enough to offer later chunks as a `priorElementNames` reference.
  });

  it('marks a relationship ungrounded when its own top-level passage cannot be found', async () => {
    const chunkText = 'Nothing here relates any systems to each other.';
    const llmClient = llmClientFor(chunkText, [], {
      elements: [],
      relationships: [{ relationshipType: 'uses', fromName: 'A', toName: 'B', passage: 'A uses B directly', confidence: 0.7, attributes: [] }],
    });

    const { candidates } = await extractProseChunk({ llmClient, inputName: 'doc.txt', location: LOCATION, chunkText, priorElementNames: [], sourceRefForOffset: identitySourceRefForOffset });
    expect(candidates[0]?.ungrounded).toBe(true);
    expect(candidates[0]?.evidence.warnings).toContainEqual({ code: 'PASSAGE_NOT_FOUND', field: 'relationship' });
  });

  it('drops an attribute key the model was never told about (UNKNOWN_ATTRIBUTE_KEY), never storing it', async () => {
    const chunkText = 'The Payroll system has a launch budget of two million.';
    const llmClient = llmClientFor(chunkText, [], {
      elements: [
        {
          elementType: 'system',
          name: 'Payroll',
          namePassage: 'The Payroll system',
          nameConfidence: 0.9,
          parentName: null,
          attributes: [{ key: 'budget', value: 'two million', passage: 'launch budget of two million', confidence: 0.7 }],
        },
      ],
      relationships: [],
    });

    const { candidates } = await extractProseChunk({ llmClient, inputName: 'doc.txt', location: LOCATION, chunkText, priorElementNames: [], sourceRefForOffset: identitySourceRefForOffset });
    const proposal = candidates[0]?.proposal as ElementProposal;
    expect('budget' in proposal.attributes).toBe(false);
    expect(candidates[0]?.evidence.warnings).toContainEqual({ code: 'UNKNOWN_ATTRIBUTE_KEY', key: 'budget' });
  });

  it('orders candidates by their own passage start offset (§4.5), regardless of the model\'s own list order', async () => {
    const chunkText = 'Alpha is a system. Later, Beta is mentioned as a system too.';
    const llmClient = llmClientFor(chunkText, [], {
      elements: [
        { elementType: 'system', name: 'Beta', namePassage: 'Beta is mentioned', nameConfidence: 0.8, parentName: null, attributes: [] },
        { elementType: 'system', name: 'Alpha', namePassage: 'Alpha is a system', nameConfidence: 0.8, parentName: null, attributes: [] },
      ],
      relationships: [],
    });

    const { candidates } = await extractProseChunk({ llmClient, inputName: 'doc.txt', location: LOCATION, chunkText, priorElementNames: [], sourceRefForOffset: identitySourceRefForOffset });
    expect(candidates.map((c) => (c.proposal as ElementProposal).name)).toEqual(['Alpha', 'Beta']);
    expect(candidates.map((c) => c.seq)).toEqual([0, 1]);
  });

  it('propagates a malformed prompt-B response as ExtractProseError rather than silently accepting it', async () => {
    const chunkText = 'Some text.';
    const userMessage = buildPromptBUserMessage({ inputName: 'doc.txt', location: LOCATION, chunkText });
    const request: LlmRequest = { effort: 'medium', system: PROMPT_B_SYSTEM, format: { type: 'json_schema', schema: PROMPT_B_SCHEMA }, messages: [{ role: 'user', content: userMessage }] };
    const key = hashLlmRequest(request);
    const llmClient = new RecordedLlmClient({ cassettes: new Map([[key, { text: 'not json', stopReason: 'end_turn', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }]]) });

    await expect(extractProseChunk({ llmClient, inputName: 'doc.txt', location: LOCATION, chunkText, priorElementNames: [], sourceRefForOffset: identitySourceRefForOffset })).rejects.toThrow(ExtractProseError);
  });

  it('propagates a schema-invalid response (missing a required field) as ExtractProseError', async () => {
    const chunkText = 'Some text.';
    const llmClient = llmClientFor(chunkText, [], { elements: [{ elementType: 'system', name: 'X' }], relationships: [] });

    await expect(extractProseChunk({ llmClient, inputName: 'doc.txt', location: LOCATION, chunkText, priorElementNames: [], sourceRefForOffset: identitySourceRefForOffset })).rejects.toThrow(/schema validation/);
  });
});
