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
