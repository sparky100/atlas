/**
 * `pnpm ai:eval [--id <question>] [--model <id>] [--json]` (ADR-028 §9): asks
 * the fixed question set in `src/tools/eval/evalSet.ts` of the fixed model in
 * `src/tools/fixtures/evalEstate.ts`, through the real loop (`runAsk`) and
 * the real tools, against the real provider with `ANTHROPIC_API_KEY`, and
 * scores each answer on tools used and elements cited (never wording).
 *
 * It costs money and needs a key, so it is run on demand by whoever holds
 * one and is not part of `pnpm test`. Nothing here is faked: with no key it
 * stops and says so. Exit code 1 when any question fails.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AskModelClient, AskModelRequest, AskModelResponse } from '../src/tools/askLoop';
import { runAsk } from '../src/tools/askLoop';
import { EVAL_SET } from '../src/tools/eval/evalSet';
import { scoreAnswer, summarise, type EvalScore } from '../src/tools/eval/scoreEval';
import { evalContext } from '../src/tools/fixtures/evalEstate';
import { isCliEntrypoint } from './isCliEntrypoint';

const DEFAULT_EVAL_MODEL = 'claude-sonnet-5-5';

export function createDirectAskClient(apiKey: string, model: string): AskModelClient {
  const anthropic = new Anthropic({ apiKey });
  return {
    complete: async (request: AskModelRequest): Promise<AskModelResponse> => {
      const messages: Anthropic.Messages.MessageParam[] = request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content:
            typeof m.content === 'string'
              ? m.content
              : m.content.map((b) => {
                  if (b.type === 'text') return { type: 'text' as const, text: b.text };
                  if (b.type === 'tool_use') return { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input };
                  return { type: 'tool_result' as const, tool_use_id: b.toolUseId, content: b.content, ...(b.isError ? { is_error: true } : {}) };
                }),
        }));
      const message = await anthropic.messages.create({
        model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages,
        tools: request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema })),
        ...(request.toolChoice === 'none' ? { tool_choice: { type: 'none' as const } } : {}),
      });
      const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      const toolCalls = message.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }] : []));
      return {
        text,
        ...(message.stop_reason ? { stopReason: message.stop_reason } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      };
    },
  };
}

function argValue(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ai:eval needs ANTHROPIC_API_KEY. It runs against the real provider and costs money, so it is run on demand by whoever holds a key.');
    process.exitCode = 1;
    return;
  }
  const only = argValue(args, '--id');
  const model = argValue(args, '--model') ?? process.env.ASK_EVAL_MODEL ?? DEFAULT_EVAL_MODEL;
  const questions = only ? EVAL_SET.filter((q) => q.id === only) : EVAL_SET;
  if (questions.length === 0) {
    console.error(`No question with id "${only ?? ''}". Ids: ${EVAL_SET.map((q) => q.id).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const client = createDirectAskClient(apiKey, model);
  const scores: EvalScore[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  for (const q of questions) {
    // Questions run one at a time: the provider's rate limits, not speed, are the constraint.
    const result = await runAsk({ client, ctx: evalContext(), history: [], question: q.question });
    inputTokens += result.inputTokens;
    outputTokens += result.outputTokens;
    const score = scoreAnswer(q, result);
    scores.push(score);
    if (!args.includes('--json')) {
      console.log(`${score.pass ? 'PASS' : 'FAIL'}  ${q.id}  (${String(result.rounds)} rounds)`);
      for (const c of score.checks.filter((x) => !x.ok)) console.log(`        ✗ ${c.name}`);
      if (!score.pass) console.log(`        answer: ${result.answer.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  }

  const summary = summarise(scores);
  if (args.includes('--json')) console.log(JSON.stringify({ model, ...summary, inputTokens, outputTokens, scores }, null, 2));
  else console.log(`\n${String(summary.passed)}/${String(summary.total)} passed with ${model} (${String(inputTokens)} input, ${String(outputTokens)} output tokens)`);
  if (summary.failed.length > 0) process.exitCode = 1;
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
}
