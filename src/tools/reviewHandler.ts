import type { UUID } from '../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import type { BranchRow, DecisionOptionRatingRow, DecisionRow } from '../db/types';
import type { AskModelClient } from './askLoop';
import { buildReviewerDigest } from './reviewDigest';
import { reviewerPrompt, type ReviewLens } from './reviewPrompt';
import type { ModelSnapshot, ToolContext } from './types';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNSAFE_VERDICT = /\b(?:pass|fail|compliant|approved|recommend(?:ed|ation)?|score)\b|\b\d+\s*\/\s*\d+\b/i;

export interface SavedReview {
  decision: DecisionRow;
  options: Pick<BranchRow, 'id' | 'title' | 'name' | 'description'>[];
  ratings: Pick<DecisionOptionRatingRow, 'branch_id' | 'criterion' | 'level' | 'note'>[];
  concerns: ElementsHeadRow[];
  concernRelationships: RelationshipsHeadRow[];
  principles: { title: string; stance: 'follows' | 'departs'; reason: string }[];
  goals: string[];
}

export interface ReviewDeps {
  loadDecision: (id: UUID) => Promise<DecisionRow | null>;
  loadModel: (id: UUID) => Promise<{ id: UUID; orgId: UUID; name: string } | null>;
  callerRole: (orgId: UUID) => Promise<string | null>;
  settings: (orgId: UUID) => Promise<{ assistantEnabled: boolean; agentsEnabled: boolean; keySet: boolean; shareCost: boolean }>;
  mainCommit: (modelId: UUID) => Promise<UUID | null>;
  loadSavedReview: (decision: DecisionRow, snapshot: ModelSnapshot) => Promise<SavedReview>;
  createContext: (model: { id: UUID; name: string }, commitId: UUID, shareCost: boolean) => ToolContext;
  newRunId: () => string;
  createClient: (orgId: UUID, runId: string, lens: ReviewLens) => AskModelClient;
  hash: (text: string) => Promise<string>;
}

export type ReviewOutcome =
  | { status: 'invalid' | 'forbidden' | 'not_enabled' | 'cost_blocked'; message: string }
  | { status: 'not_found' | 'empty_model' }
  | { status: 'incomplete'; message: string; inputTokens: number; outputTokens: number }
  | { status: 'done'; notes: ReviewNote[]; inputHash: string; runId: string; inputTokens: number; outputTokens: number; dropped: number };

export interface ReviewNote {
  note: string;
  question: string;
  basedOn: { kind: 'option' | 'element' | 'none'; label: string; branchId?: UUID; elementId?: UUID };
}

export function parseReviewBody(body: unknown): { decisionId: UUID; lens: ReviewLens } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const r = body as Record<string, unknown>;
  if (typeof r.decisionId !== 'string' || !UUID_SHAPE.test(r.decisionId)) return null;
  if (r.lens !== 'challenge' && r.lens !== 'cyber' && r.lens !== 'data') return null;
  return { decisionId: r.decisionId, lens: r.lens };
}

export async function handleReview(deps: ReviewDeps, body: unknown): Promise<ReviewOutcome> {
  const parsed = parseReviewBody(body);
  if (!parsed) return { status: 'invalid', message: 'A decision id and review lens are required.' };
  const decision = await deps.loadDecision(parsed.decisionId);
  if (!decision) return { status: 'not_found' };
  const model = await deps.loadModel(decision.model_id);
  if (model?.orgId !== decision.org_id) return { status: 'not_found' };
  const role = await deps.callerRole(model.orgId);
  if (role !== 'owner' && role !== 'architect' && role !== 'contributor') return { status: 'forbidden', message: 'Second opinions are for contributors, architects and owners.' };
  const settings = await deps.settings(model.orgId);
  if (!settings.assistantEnabled || !settings.agentsEnabled) return { status: 'not_enabled', message: 'An owner needs to switch on Ask Atlas and agents.' };
  if (!settings.keySet) return { status: 'not_enabled', message: "An owner needs to add the organisation's AI key. The Designer trial does not cover second opinions." };
  if (decision.status !== 'proposed') return { status: 'not_enabled', message: 'Second opinions are offered while a decision is still being weighed.' };
  const commitId = await deps.mainCommit(model.id);
  if (!commitId) return { status: 'empty_model' };
  const ctx = deps.createContext(model, commitId, settings.shareCost);
  const snapshot = await ctx.snapshot();
  const saved = await deps.loadSavedReview(decision, snapshot);
  const digest = buildReviewerDigest({ ...saved, snapshot, shareCost: settings.shareCost });
  // A warning with a generic "send anyway" would let a contributor override an owner-only choice.
  if (digest.containsMoneyText) return { status: 'cost_blocked', message: 'Saved text contains an amount of money. Remove it before requesting a second opinion, or ask an owner to allow cost sharing.' };
  const inputHash = await deps.hash(digest.text);
  const runId = deps.newRunId();
  const response = await deps.createClient(model.orgId, runId, parsed.lens).complete({
    system: reviewerPrompt(parsed.lens),
    messages: [{ role: 'user', content: digest.text }],
    tools: [],
    toolChoice: 'none',
    maxTokens: 1600,
  });
  const usage = { inputTokens: response.inputTokens, outputTokens: response.outputTokens };
  if ((response.stopReason !== undefined && response.stopReason !== 'end_turn') || response.toolCalls?.length) return { status: 'incomplete', message: 'The reviewer was cut short. Nothing was kept.', ...usage };
  let parsedResponse: unknown;
  try { parsedResponse = JSON.parse(response.text); } catch { return { status: 'incomplete', message: 'The reviewer did not return usable questions.', ...usage }; }
  if (typeof parsedResponse !== 'object' || parsedResponse === null || !Array.isArray((parsedResponse as { notes?: unknown }).notes)) return { status: 'incomplete', message: 'The reviewer did not return usable questions.', ...usage };
  const rawNotes = (parsedResponse as { notes: unknown[] }).notes;
  const notes: ReviewNote[] = [];
  let dropped = 0;
  for (const raw of rawNotes) {
    if (notes.length >= 5) { dropped++; continue; }
    if (typeof raw !== 'object' || raw === null) { dropped++; continue; }
    const n = raw as Record<string, unknown>;
    if (typeof n.note !== 'string' || typeof n.question !== 'string' || typeof n.basedOn !== 'string' || !n.note.trim() || !n.question.trim() || n.note.length > 500 || n.question.length > 500 || UNSAFE_VERDICT.test(`${n.note} ${n.question}`) || !n.question.trim().endsWith('?') || Object.keys(n).some((key) => !['note', 'question', 'basedOn'].includes(key))) { dropped++; continue; }
    const branchId = digest.optionIdsByLabel.get(n.basedOn);
    const elementId = digest.elementIdsByLabel.get(n.basedOn);
    const basedOn: ReviewNote['basedOn'] = branchId ? { kind: 'option', label: n.basedOn, branchId } : elementId ? { kind: 'element', label: n.basedOn, elementId } : { kind: 'none', label: 'Not tied to a record' };
    notes.push({ note: n.note.trim(), question: n.question.trim(), basedOn });
  }
  return { status: 'done', notes, inputHash, runId, ...usage, dropped };
}
