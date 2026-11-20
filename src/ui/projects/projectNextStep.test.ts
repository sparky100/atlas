import { describe, expect, it } from 'vitest';
import { projectNextStep, type NextStepInput } from './projectNextStep';

const base: NextStepInput = { isOpen: true, purpose: 'Replace the billing engine.', hasCapability: true, decisions: [], changes: [], canStartDecision: true, canCreateChange: true, canDraftChange: true };
const decision = (status: string) => ({ id: 'd1', title: 'Which system?', status });
const change = (status: string) => ({ id: 'c1', title: 'Cutover', name: 'cutover', status });

describe('projectNextStep', () => {
  it('has no next step for a closed project', () => {
    expect(projectNextStep({ ...base, isOpen: false })).toBeNull();
  });
  it('asks for the purpose, then the capability, before anything else', () => {
    expect(projectNextStep({ ...base, purpose: '  ', hasCapability: false })?.kind).toBe('purpose');
    expect(projectNextStep({ ...base, hasCapability: false })?.kind).toBe('capability');
  });
  it('offers to start a decision when none exists, or says who can when the role cannot', () => {
    expect(projectNextStep(base)?.action).toEqual({ kind: 'start-decision' });
    const blocked = projectNextStep({ ...base, canStartDecision: false });
    expect(blocked?.kind).toBe('decide');
    expect(blocked?.action).toEqual({ kind: 'none' });
    expect(blocked?.body).toMatch(/owner, architect or contributor/);
  });
  it('points at the open decision to compare and choose', () => {
    const step = projectNextStep({ ...base, decisions: [decision('proposed')] });
    expect(step?.kind).toBe('compare');
    expect(step?.action).toEqual({ kind: 'open-decision', id: 'd1', label: 'Open Which system?' });
  });
  it('does not tell someone who cannot choose to choose', () => {
    const step = projectNextStep({ ...base, decisions: [decision('proposed')], canChoose: false });
    expect(step?.title).toBe('Compare your options');
    expect(step?.body).toMatch(/owner or architect makes the choice/);
    expect(step?.body).not.toMatch(/then choose/);
  });
  it('offers the change once something is chosen and no change exists', () => {
    expect(projectNextStep({ ...base, decisions: [decision('accepted')] })?.action).toEqual({ kind: 'start-change' });
    expect(projectNextStep({ ...base, decisions: [decision('accepted')], canDraftChange: false })?.action).toEqual({ kind: 'none' });
  });
  it('then takes the change through review, and finally closes the project', () => {
    const chosen = [decision('accepted')];
    expect(projectNextStep({ ...base, decisions: chosen, changes: [change('draft')] })?.action).toEqual({ kind: 'open-change', id: 'c1', label: 'Open Cutover' });
    expect(projectNextStep({ ...base, decisions: chosen, changes: [change('merged')] })?.kind).toBe('finish');
  });
  it('does not say a choice exists when every decision ended without one', () => {
    const step = projectNextStep({ ...base, decisions: [decision('rejected'), decision('superseded')] });
    expect(step?.kind).toBe('decide');
    expect(step?.title).toBe('Start a new decision');
    expect(step?.action).toEqual({ kind: 'start-decision' });
    expect(projectNextStep({ ...base, canStartDecision: false, decisions: [decision('rejected')] })?.action).toEqual({ kind: 'none' });
  });
  it('says the choice is not carried out when every change was cancelled', () => {
    const step = projectNextStep({ ...base, decisions: [decision('accepted')], changes: [change('cancelled')] });
    expect(step?.kind).toBe('change');
    expect(step?.body).toMatch(/not been carried out/);
    expect(step?.action).toEqual({ kind: 'start-change' });
  });
  it('does not claim the benefit was achieved once changes are merged', () => {
    const step = projectNextStep({ ...base, decisions: [decision('accepted')], changes: [change('merged')] });
    expect(step?.body).toMatch(/does not show the project achieved its purpose/);
  });
  it('says no option is chosen while a decision is open', () => {
    expect(projectNextStep({ ...base, decisions: [decision('proposed')] })?.body).toMatch(/No option is chosen yet/);
  });
});
