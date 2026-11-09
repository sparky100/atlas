import type { GettingStartedCounts } from '../../db/landscape';

export interface GettingStartedStep {
  id: 'capabilities' | 'system' | 'link';
  label: string;
  done: boolean;
}

/** The checklist's three steps, ticked from real model counts (nothing stored). */
export function gettingStartedSteps(counts: GettingStartedCounts): GettingStartedStep[] {
  return [
    { id: 'capabilities', label: 'Add your capabilities', done: counts.capabilities > 0 },
    { id: 'system', label: 'Add a system', done: counts.systems > 0 },
    { id: 'link', label: 'Link a system to the capability it supports', done: counts.supportsEdges > 0 },
  ];
}

/** Shown while the model is empty enough that a step is still open. */
export function showGettingStarted(steps: readonly GettingStartedStep[]): boolean {
  return steps.some((s) => !s.done);
}

export const gettingStartedDismissKey = (modelId: string): string => `atlas:get-started-dismissed:${modelId}`;
