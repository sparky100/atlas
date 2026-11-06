/**
 * ADR-028 §3–§6: the question-and-lookup loop, pure. It owns the limits, the
 * wrapping of tool results as data, and the citation check; the model call
 * itself is an injected `AskModelClient`, so it is tested without a network
 * and the edge function supplies a client that goes through `llm-proxy`.
 */
import type { LlmProxyContentBlock, LlmProxyMessage, LlmProxyToolCall, LlmProxyToolDefinition } from '../contracts/llmProxy';
import { ASK_LIMIT_NOTICE, askSystemPrompt } from './askPrompt';
import { callTool, MODEL_TOOLS } from './index';
import type { ToolContext } from './types';

export const ASK_MAX_ROUNDS = 6;
export const ASK_MAX_TOKENS_PER_ROUND = 2000;
export const ASK_MAX_TOOL_CHARS = 60_000;
export const ASK_MAX_HISTORY_TURNS = 10;
export const ASK_MAX_CALLS_PER_ROUND = 4;
export const ASK_MAX_QUESTION_CHARS = 2000;

export interface AskModelRequest {
  system: string;
  messages: LlmProxyMessage[];
  tools: LlmProxyToolDefinition[];
  /** `'none'` on the closing round, so the model must write its answer. */
  toolChoice: 'auto' | 'none';
  maxTokens: number;
}

export interface AskModelResponse {
  text: string;
  stopReason?: string;
  toolCalls?: LlmProxyToolCall[];
  inputTokens: number;
  outputTokens: number;
}

export interface AskModelClient {
  complete: (request: AskModelRequest) => Promise<AskModelResponse>;
}

export interface AskTurn {
  role: 'user' | 'assistant';
  text: string;
}

export type AskEvent = { type: 'tool_call'; name: string } | { type: 'tool_done'; name: string; ok: boolean };

export interface AskToolUse {
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
}

export type AskStatus = 'answered' | 'incomplete' | 'refused';

export interface AskResult {
  status: AskStatus;
  /** The written answer with unverified citations removed. Plain text/Markdown, never HTML. */
  answer: string;
  /** Element ids cited in the answer that a tool actually returned in this question, in first-cited order. */
  citations: string[];
  /** True when at least one citation survived. False is shown as "ungrounded". */
  grounded: boolean;
  /** How many cited ids no tool returned (removed from the answer). */
  unverifiedRemoved: number;
  toolUses: AskToolUse[];
  rounds: number;
  /** Which limit ended the lookups, when one did. */
  limit?: 'rounds' | 'budget';
  inputTokens: number;
  outputTokens: number;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const CITATION = /\[\[element:([^\]\s]*)\]\]/g;

/** Wraps a tool result so the model sees it as labelled data; a closing tag inside the data cannot end the block early. */
export function wrapToolData(name: string, json: string): string {
  return `<tool-data tool="${name}">\n${json.replaceAll('</tool-data>', '<\\/tool-data>')}\n</tool-data>`;
}

/** Splits an answer into verified and unverified citations; an unverified `[[element:…]]` is removed from the text. */
export function verifyCitations(answer: string, returnedIds: ReadonlySet<string>): { answer: string; citations: string[]; unverifiedRemoved: number } {
  const citations: string[] = [];
  let unverifiedRemoved = 0;
  const cleaned = answer.replace(CITATION, (_whole, id: string) => {
    const lower = id.toLowerCase();
    if (returnedIds.has(lower)) {
      if (!citations.includes(lower)) citations.push(lower);
      return `[[element:${lower}]]`;
    }
    unverifiedRemoved += 1;
    return '';
  });
  return { answer: cleaned.replace(/[ \t]{2,}/g, ' ').trim(), citations, unverifiedRemoved };
}

function toolDefinitions(): LlmProxyToolDefinition[] {
  return MODEL_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The last `ASK_MAX_HISTORY_TURNS` turns, starting on a user turn so the conversation always opens correctly. */
export function trimHistory(history: readonly AskTurn[]): AskTurn[] {
  const recent = history.filter((t) => t.text.trim() !== '').slice(-ASK_MAX_HISTORY_TURNS);
  while (recent.length > 0 && recent[0]?.role !== 'user') recent.shift();
  return recent;
}

export interface RunAskInput {
  client: AskModelClient;
  ctx: ToolContext;
  history: readonly AskTurn[];
  question: string;
  onEvent?: ((event: AskEvent) => void) | undefined;
}

export async function runAsk(input: RunAskInput): Promise<AskResult> {
  const { client, ctx, onEvent } = input;
  const system = askSystemPrompt(ctx.stamp.modelName, ctx.now().toISOString().slice(0, 10));
  const tools = toolDefinitions();
  const question = input.question.trim().slice(0, ASK_MAX_QUESTION_CHARS);

  const messages: LlmProxyMessage[] = [...trimHistory(input.history).map((t) => ({ role: t.role, content: t.text })), { role: 'user' as const, content: question }];
  const returnedIds = new Set<string>();
  const toolUses: AskToolUse[] = [];
  let budgetLeft = ASK_MAX_TOOL_CHARS;
  let rounds = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let limit: AskResult['limit'];

  const finish = (status: AskStatus, text: string): AskResult => {
    // The model and commit ids appear in every result's stamp but are not elements.
    const elementIds = new Set([...returnedIds].filter((id) => id !== ctx.stamp.modelId && id !== ctx.stamp.commitId));
    const checked = verifyCitations(text, elementIds);
    return {
      status,
      answer: checked.answer,
      citations: checked.citations,
      grounded: checked.citations.length > 0,
      unverifiedRemoved: checked.unverifiedRemoved,
      toolUses,
      rounds,
      ...(limit ? { limit } : {}),
      inputTokens,
      outputTokens,
    };
  };

  for (;;) {
    const closing = limit !== undefined;
    const response = await client.complete({ system, messages, tools, toolChoice: closing ? 'none' : 'auto', maxTokens: ASK_MAX_TOKENS_PER_ROUND });
    rounds += 1;
    inputTokens += response.inputTokens;
    outputTokens += response.outputTokens;

    if (response.stopReason === 'refusal') return finish('refused', '');
    const calls = response.toolCalls ?? [];
    if (calls.length === 0 || closing) {
      // `max_tokens` means the answer was cut off: return it, but say it is not complete.
      return finish(limit !== undefined || response.stopReason === 'max_tokens' ? 'incomplete' : 'answered', response.text);
    }

    const assistantBlocks: LlmProxyContentBlock[] = [...(response.text.trim() === '' ? [] : [{ type: 'text' as const, text: response.text }]), ...calls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.input }))];
    messages.push({ role: 'assistant', content: assistantBlocks });

    const resultBlocks: LlmProxyContentBlock[] = [];
    for (const [index, call] of calls.entries()) {
      onEvent?.({ type: 'tool_call', name: call.name });
      let ok = false;
      let content: string;
      if (index >= ASK_MAX_CALLS_PER_ROUND) {
        content = wrapToolData(call.name, JSON.stringify({ error: `Only ${String(ASK_MAX_CALLS_PER_ROUND)} lookups are run per round. Ask again in the next round if still needed.` }));
      } else if (budgetLeft <= 0) {
        limit = 'budget';
        content = wrapToolData(call.name, JSON.stringify({ error: 'The result budget for this question is used up.' }));
      } else {
        const result = await callTool(ctx, call.name, call.input);
        ok = result.ok;
        const json = JSON.stringify(result.ok ? { stamp: result.stamp, total: result.total, truncated: result.truncated, data: result.data } : { error: result.error });
        if (json.length > budgetLeft) {
          limit = 'budget';
          ok = false;
          content = wrapToolData(call.name, JSON.stringify({ error: 'This result would exceed the size budget for this question, so it was not shown. Narrow the lookup.' }));
        } else {
          budgetLeft -= json.length;
          if (result.ok) for (const id of json.match(UUID) ?? []) returnedIds.add(id);
          content = wrapToolData(call.name, json);
        }
      }
      toolUses.push({ name: call.name, input: asRecord(call.input), ok });
      onEvent?.({ type: 'tool_done', name: call.name, ok });
      resultBlocks.push({ type: 'tool_result', toolUseId: call.id, content, ...(ok ? {} : { isError: true }) });
    }
    if (limit === undefined && rounds >= ASK_MAX_ROUNDS) limit = 'rounds';
    // The notice rides in the same user turn as the results, so roles keep alternating.
    if (limit !== undefined) resultBlocks.push({ type: 'text', text: ASK_LIMIT_NOTICE });
    messages.push({ role: 'user', content: resultBlocks });
  }
}
