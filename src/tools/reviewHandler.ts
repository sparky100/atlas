/**
 * D2: everything the `review-agent` edge function decides, with its
 * collaborators injected so it is tested without a Deno runtime (the same
 * split `designHandler.ts` uses). Order matters: the decision must be
 * readable by the caller, the organisation must have Ask Atlas and the
 * agents switch on and its OWN AI key saved (reviewers never draw on the
 * free trial), the decision must still be `proposed`, and only then is
 * anything sent to a provider.
 *
 * The reviewers write nothing. Their notes are text for a person to read and
 * copy; nothing is saved except in PR 4, and only when a person keeps one.
 */
import type { UUID } from '../contracts/delta';
import { parseReviewNotes, type ReviewNote } from './reviewNotes';
import { reviewSystemPrompt, reviewUserMessage, type ReviewLens } from './reviewPrompt';

export interface ReviewDecisionInfo {
  id: UUID;
  modelId: UUID;
  orgId: UUID;
  status: 'proposed' | 'accepted' | 'rejected' | 'superseded';
}

export interface ReviewHandlerDeps {
  /** Read with the caller's own session: a decision the caller cannot read is `null`. */
  loadDecision: (decisionId: UUID) => Promise<ReviewDecisionInfo | null>;
  /** The caller's role in the organisation, or `null`. */
  callerRole: (orgId: UUID) => Promise<string | null>;
  /** The organisation's own switches and key flag. */
  agentSettings: (orgId: UUID) => Promise<{ assistantEnabled: boolean; agentsEnabled: boolean; keySet: boolean }>;
  /** Build the allowlisted digest from saved rows, and its SHA-256. */
  buildDigest: (decision: ReviewDecisionInfo, lens: ReviewLens) => Promise<{ text: string; inputHash: string }>;
  /** One model call through the proxy on the organisation's own key. */
  runReview: (args: { system: string; user: string; lens: ReviewLens; modelTier: 'light' | undefined }) => Promise<{ text: string; status: 'answered' | 'incomplete' }>;
  now: () => Date;
}

export type ReviewOutcome =
  | { status: 'invalid'; message: string }
  | { status: 'not_found' }
  | { status: 'forbidden'; message: string }
  | { status: 'not_enabled'; message: string }
  | { status: 'done'; lens: ReviewLens; inputHash: string; notes: ReviewNote[]; problems: string[]; modelStatus: 'answered' | 'incomplete' };

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LENSES: readonly ReviewLens[] = ['challenge', 'cyber', 'data'];

export interface ParsedReview {
  decisionId: UUID;
  lens: ReviewLens;
}

export function parseReviewBody(body: unknown): ParsedReview | string {
  if (typeof body !== 'object' || body === null) return 'A request body is required.';
  const r = body as Record<string, unknown>;
  if (typeof r.decisionId !== 'string' || !UUID_SHAPE.test(r.decisionId)) return 'decisionId must be a decision id.';
  if (typeof r.lens !== 'string' || !LENSES.includes(r.lens as ReviewLens)) return 'lens must be one of challenge, cyber or data.';
  return { decisionId: r.decisionId, lens: r.lens as ReviewLens };
}

export async function handleReview(deps: ReviewHandlerDeps, body: unknown): Promise<ReviewOutcome> {
  const parsed = parseReviewBody(body);
  if (typeof parsed === 'string') return { status: 'invalid', message: parsed };

  const decision = await deps.loadDecision(parsed.decisionId);
  if (!decision) return { status: 'not_found' };

  const role = await deps.callerRole(decision.orgId);
  if (role !== 'owner' && role !== 'architect' && role !== 'contributor') {
    return { status: 'forbidden', message: 'Second opinions are for contributors and above.' };
  }

  const settings = await deps.agentSettings(decision.orgId);
  if (!settings.assistantEnabled || !settings.agentsEnabled) {
    return { status: 'not_enabled', message: 'Agents are not switched on for this organisation. An owner can switch them on in organisation settings.' };
  }
  // No trial for reviewers (Simon, 2026-11-20): a second opinion comes after drafting, so an owner can add a key by then.
  if (!settings.keySet) {
    return { status: 'not_enabled', message: "Second opinions need the organisation's own AI key. An owner needs to add it in organisation settings." };
  }
  if (decision.status !== 'proposed') {
    return { status: 'not_enabled', message: 'Second opinions are offered while a decision is still being weighed.' };
  }

  const { text, inputHash } = await deps.buildDigest(decision, parsed.lens);
  const system = reviewSystemPrompt(parsed.lens, deps.now().toISOString().slice(0, 10));
  const modelTier: 'light' | undefined = parsed.lens === 'challenge' ? undefined : 'light';
  const result = await deps.runReview({ system, user: reviewUserMessage(parsed.lens, text), lens: parsed.lens, modelTier });
  const review = parseReviewNotes(result.text);
  const problems = [...review.problems];
  if (result.status !== 'answered' && problems.length === 0) problems.push('The reviewer was cut short, so this list may be incomplete.');
  return { status: 'done', lens: parsed.lens, inputHash, notes: review.notes, problems, modelStatus: result.status };
}
