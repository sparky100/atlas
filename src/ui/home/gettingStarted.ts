import type { GettingStartedCounts } from '../../db/landscape';

export interface GettingStartedStep {
  id: 'capabilities' | 'system' | 'link' | 'invite';
  label: string;
  done: boolean;
}

/**
 * The checklist's steps, ticked from real model counts (nothing stored). The
 * fourth, "Invite a colleague", is only offered to an owner (`invites` is
 * the number of invites the organisation has sent, `null` when the caller
 * is not an owner or the count isn't known).
 */
export function gettingStartedSteps(counts: GettingStartedCounts, invites: number | null = null): GettingStartedStep[] {
  return [
    { id: 'capabilities', label: 'Add your capabilities', done: counts.capabilities > 0 },
    { id: 'system', label: 'Add a system', done: counts.systems > 0 },
    { id: 'link', label: 'Link a system to the capability it supports', done: counts.supportsEdges > 0 },
    ...(invites === null ? [] : [{ id: 'invite' as const, label: 'Invite a colleague', done: invites > 0 }]),
  ];
}

/** Shown while the model is empty enough that a step is still open. */
export function showGettingStarted(steps: readonly GettingStartedStep[]): boolean {
  return steps.some((s) => !s.done);
}

export const gettingStartedDismissKey = (modelId: string): string => `atlas:get-started-dismissed:${modelId}`;

export const firstVisitDismissKey = (modelId: string): string => `atlas:first-visit-dismissed:${modelId}`;

export interface FirstVisitLink {
  to: string;
  text: string;
}

/** What the "First visit" card says for each role — what they can do here, not what the product is. */
export function firstVisitContent(role: string | null): { intro: string; links: FirstVisitLink[] } {
  const browse: FirstVisitLink[] = [
    { to: 'capability-map', text: 'Browse the capability map' },
    { to: 'landscape', text: 'See systems and how they connect' },
  ];
  if (role === 'owner' || role === 'architect') {
    return { intro: 'This model already has data. Problems are listed under “Where to focus” below.', links: [...browse, { to: 'work', text: 'See what is being worked on' }] };
  }
  if (role === 'contributor') {
    return { intro: 'You can propose changes without touching the live model. Look around first.', links: [...browse, { to: 'changes', text: 'Start or open a change' }] };
  }
  return { intro: 'You can look around. Pick a capability to see which systems support it.', links: browse };
}
