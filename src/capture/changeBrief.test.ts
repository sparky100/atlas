import { describe, expect, it, vi } from 'vitest';
import { MAX_CHANGE_BRIEF_CHARS } from '../contracts/capture';
import type { Json } from '../contracts/delta';
import type { ElementsHeadRow } from '../contracts/rows';
import { emptyHead } from '../engine/deltas';
import type { LlmRequest } from './llm/client';
import { buildMatchIndex } from './matchIndex';
import { CHANGE_BRIEF_SYSTEM } from './prompts/changeBrief';
import { runCapture } from './runCapture';

function modelElement(id: string, name: string, type: ElementsHeadRow['element_type'] = 'system', parentId: string | null = null): ElementsHeadRow {
  return {
    element_id: id, name, element_type: type, parent_id: parentId,
    attributes: { lifecycleStatus: 'active', isExternal: false }, exists_delta_id: id,
  };
}

function draft(text: string, response: unknown, rows: ElementsHeadRow[]) {
  const head = emptyHead();
  for (const row of rows) {
    head.elements.set(row.element_id, { name: row.name, elementType: row.element_type, parentId: row.parent_id, attributes: row.attributes as Record<string, Json>, existsDeltaId: row.exists_delta_id });
  }
  const complete = vi.fn((_request: LlmRequest) => Promise.resolve({
    text: JSON.stringify(response), stopReason: 'end_turn', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
  }));
  let id = 0;
  return {
    complete,
    result: runCapture({
      inputName: 'Proposed change', source: { format: 'change_brief', text }, documentDate: null,
      llmClient: { complete }, matchIndex: buildMatchIndex(rows, []), mainHead: head, mintId: () => `draft-${String(++id)}`,
    }),
  };
}

describe('AI change briefs', () => {
  it('adds a named integration using the current model and a passage from the brief', async () => {
    const text = 'Billing should send invoices to Finance.';
    const { complete, result } = draft(text, { elements: [], relationships: [
      { relationshipType: 'flows_to', fromName: 'Billing', toName: 'Finance', passage: text, confidence: 0.9, attributes: [] },
    ] }, [modelElement('billing', 'Billing'), modelElement('finance', 'Finance'), modelElement('payroll', 'Payroll')]);
    expect((await result)).toMatchObject({ status: 'parsed', candidates: [{
      class: 'new',
      proposal: { from: { elementId: 'billing' }, to: { elementId: 'finance' } },
      evidence: { passage: text, sourceRef: { kind: 'text', start: 0, end: text.length } },
    }] });
    const request = complete.mock.calls[0]?.[0];
    expect(request?.system).toBe(CHANGE_BRIEF_SYSTEM);
    expect(request?.messages[0]?.content).toContain('Billing');
    expect(request?.messages[0]?.content).not.toContain('Payroll');
  });

  it('plans the new CRM and adds only the named capability support', async () => {
    const text = 'Introduce NextCRM to support Customer Onboarding first. Legacy CRM stays in service.';
    const { result } = draft(text, {
      elements: [
        { elementType: 'system', name: 'NextCRM', namePassage: 'Introduce NextCRM', nameConfidence: 0.9, parentName: null, attributes: [] },
        { elementType: 'system', name: 'Legacy CRM', namePassage: 'Legacy CRM stays in service.', nameConfidence: 0.9, parentName: null, attributes: [] },
      ],
      relationships: [{ relationshipType: 'supports', fromName: 'NextCRM', toName: 'Customer Onboarding', passage: 'NextCRM to support Customer Onboarding first', confidence: 0.9, attributes: [{ key: 'role', value: 'primary', passage: 'first', confidence: 0.9 }] }],
    }, [modelElement('legacy', 'Legacy CRM'), modelElement('onboarding', 'Customer Onboarding', 'capability')]);
    expect(await result).toMatchObject({ status: 'parsed', candidates: [
      { class: 'new', proposal: { name: 'NextCRM', attributes: { lifecycleStatus: 'planned' } }, aliasProposals: [] },
      { class: 'new', relationshipType: 'supports', proposal: { to: { elementId: 'onboarding' }, attributes: { role: 'secondary' } } },
    ] });
  });

  it('leaves an ambiguous endpoint invalid and an invented quote unsourced', async () => {
    const text = 'Billing should send invoices to Payments. Add a Billing dependency on Finance.';
    const { result } = draft(text, { elements: [], relationships: [
      { relationshipType: 'flows_to', fromName: 'Billing', toName: 'Payments', passage: 'Billing should send invoices to Payments.', confidence: 0.9, attributes: [] },
      { relationshipType: 'uses', fromName: 'Billing', toName: 'Finance', passage: 'Confirmed by a document outside the brief', confidence: 0.9, attributes: [] },
    ] }, [modelElement('billing', 'Billing'), modelElement('payments1', 'Payments'), modelElement('payments2', 'Payments', 'container', 'billing'), modelElement('finance', 'Finance')]);
    expect(await result).toMatchObject({ status: 'parsed', candidates: [
      { class: 'invalid', draftSubjectId: null, evidence: { warnings: [{ code: 'ENDPOINT_UNRESOLVED', end: 'to' }] } },
      { class: 'unsourced', draftSubjectId: null },
    ] });
  });

  it('rejects a brief over the limit before calling the provider', async () => {
    const { complete, result } = draft('x'.repeat(MAX_CHANGE_BRIEF_CHARS + 1), {}, []);
    expect(await result).toMatchObject({ status: 'failed', errorCode: 'INPUT_TOO_LARGE' });
    expect(complete).not.toHaveBeenCalled();
  });
});
