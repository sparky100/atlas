import { describe, expect, it } from 'vitest';
import { askToChooseComment, decisionNextStep, type DecisionNextStepInput } from './decisionNextStep';

const base: DecisionNextStepInput = { status: 'proposed', optionCount: 3, ratedOptionCount: 0, canAddOption: true, canChoose: false, chosenTitle: null };
describe('decisionNextStep', () => {
  it('asks for options when there are none', () => {
    expect(decisionNextStep({ ...base, optionCount: 0 })?.action).toBe('add-option');
    expect(decisionNextStep({ ...base, optionCount: 0, canAddOption: false })?.action).toBe('none');
  });
  it('tells a contributor to compare, then to ask for a choice, and never to choose', () => {
    const none = decisionNextStep(base);
    expect(none?.action).toBe('compare');
    expect(none?.body).toMatch(/owner or architect makes the choice/);
    const some = decisionNextStep({ ...base, ratedOptionCount: 2 });
    expect(some?.action).toBe('ask-to-choose');
    expect(some?.body).toMatch(/2 of 3 options rated/);
  });
  it('tells an owner or architect to choose, rated or not', () => {
    expect(decisionNextStep({ ...base, canChoose: true })?.action).toBe('choose');
    expect(decisionNextStep({ ...base, canChoose: true, ratedOptionCount: 3 })?.action).toBe('choose');
  });
  it('says what was chosen, offers the delivery, and shows nothing for a cancelled decision', () => {
    // Choosing makes no change: the next step is to start delivery, for someone who may.
    const chosen = decisionNextStep({ ...base, status: 'accepted', chosenTitle: 'Build ourselves', canStartDelivery: true });
    expect(chosen?.body).toMatch(/Build ourselves was chosen. Nothing in the model has changed yet/);
    expect(chosen).toMatchObject({ action: 'start-delivery', actionLabel: 'Start delivery' });
    expect(decisionNextStep({ ...base, status: 'accepted', chosenTitle: 'Build ourselves' })).toMatchObject({ action: 'none' });
    expect(decisionNextStep({ ...base, status: 'accepted', chosenTitle: 'Build ourselves' })?.body).toMatch(/contributor starts delivery/);
    const accepted = decisionNextStep({ ...base, status: 'accepted', chosenTitle: 'Build ourselves', deliveryStarted: true, canStartDelivery: true });
    expect(accepted?.body).toMatch(/delivery has started/);
    expect(accepted?.action).toBe('open-delivery');
    expect(accepted?.actionLabel).toBe('Open the delivery change');
    expect(decisionNextStep({ ...base, status: 'accepted', chosenTitle: null })?.action).toBe('none');
    expect(decisionNextStep({ ...base, status: 'accepted', chosenTitle: 'Stay as we are', chosenIsBaseline: true })?.action).toBe('none');
    expect(decisionNextStep({ ...base, status: 'rejected' })).toBeNull();
  });
});
describe('askToChooseComment', () => {
  it('mentions every approver by handle', () => {
    expect(askToChooseComment(['sam', 'lee'], 'Quote tool')).toBe('@sam @lee The options for "Quote tool" are ready. Please compare them and choose one.');
  });
});

describe('decisionNextStep: the outcome comes first (item 3)', () => {
  it('asks someone who can edit the decision to add the outcome before anything else', () => {
    expect(decisionNextStep({ ...base, hasOutcome: false, canEditOutcome: true })).toMatchObject({ title: 'Say what outcome you want', action: 'add-outcome', actionLabel: 'Add the outcome' });
    expect(decisionNextStep({ ...base, optionCount: 0, hasOutcome: false, canEditOutcome: true })?.action).toBe('add-outcome');
  });

  it('tells everyone else who adds it, with no action', () => {
    expect(decisionNextStep({ ...base, hasOutcome: false, canEditOutcome: false })).toMatchObject({ title: 'Waiting for the outcome', action: 'none', actionLabel: null });
  });

  it('carries on as before once the outcome is written, and never asks on a chosen decision', () => {
    expect(decisionNextStep({ ...base, hasOutcome: true, canEditOutcome: true })?.action).toBe('compare');
    expect(decisionNextStep({ ...base, status: 'accepted', chosenTitle: 'Configure the CRM', hasOutcome: false, canEditOutcome: true })?.action).not.toBe('add-outcome');
  });

  it('after choosing Buy, offers the product decision, then follows it, and still allows delivery once started', () => {
    const chosen = { ...base, status: 'accepted' as const, chosenTitle: 'Replace with a product', chosenIsBuy: true, canStartDelivery: true };
    expect(decisionNextStep({ ...chosen, productDecision: null })).toMatchObject({ title: 'Choose the product', action: 'start-product-decision', actionLabel: 'Start the product decision' });
    expect(decisionNextStep({ ...chosen, canStartDelivery: false, productDecision: null })).toMatchObject({ title: 'Choose the product', action: 'none' });
    expect(decisionNextStep({ ...chosen, productDecision: { title: 'Which product for: Replace with a product?', status: 'proposed', chosenTitle: null } }))
      .toMatchObject({ title: 'Choosing the product', action: 'open-product-decision' });
    const decided = decisionNextStep({ ...chosen, productDecision: { title: 'Which product for: Replace with a product?', status: 'accepted', chosenTitle: 'Use Salesforce Energy and Utilities Cloud' } });
    expect(decided).toMatchObject({ title: 'Product chosen', action: 'open-product-decision' });
    expect(decided?.body).toContain('Use Salesforce Energy and Utilities Cloud was chosen');
    // A Buy option whose product was settled and delivered directly keeps the delivery step.
    expect(decisionNextStep({ ...chosen, deliveryStarted: true, productDecision: null })?.action).toBe('open-delivery');
    // Configure or Build go straight to delivery as before.
    expect(decisionNextStep({ ...chosen, chosenIsBuy: false })?.action).toBe('start-delivery');
  });
});
