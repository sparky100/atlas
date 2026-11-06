/**
 * ADR-028 §9: scores one answer against its question. It checks that the
 * right tools were called, the right elements were cited, and nothing was
 * cited that should not be — not wording. A citation that was removed as
 * unverified always fails the question.
 */
import type { AskResult } from '../askLoop';
import type { EvalQuestion } from './evalSet';

export interface EvalCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface EvalScore {
  id: string;
  pass: boolean;
  checks: EvalCheck[];
}

export function scoreAnswer(question: EvalQuestion, result: AskResult): EvalScore {
  const called = new Set(result.toolUses.map((u) => u.name));
  const checks: EvalCheck[] = [];

  for (const group of question.tools) {
    checks.push({ name: `used one of ${group.join(' / ')}`, ok: group.some((t) => called.has(t)) });
  }
  const cited = new Set(result.citations);
  for (const id of question.mustCite) checks.push({ name: `cited ${id}`, ok: cited.has(id) });
  for (const id of question.mustNotCite ?? []) checks.push({ name: `did not cite ${id}`, ok: !cited.has(id) });
  for (const pattern of question.answerMatches ?? []) checks.push({ name: `answer matches ${String(pattern)}`, ok: pattern.test(result.answer) });
  for (const pattern of question.answerMustNotMatch ?? []) checks.push({ name: `answer avoids ${String(pattern)}`, ok: !pattern.test(result.answer) });
  checks.push({ name: 'no unverified reference', ok: result.unverifiedRemoved === 0 });
  checks.push({ name: 'finished normally', ok: result.status === 'answered' });
  if (question.mustCite.length > 0) checks.push({ name: 'grounded', ok: result.grounded });

  return { id: question.id, pass: checks.every((c) => c.ok), checks };
}

export function summarise(scores: readonly EvalScore[]): { total: number; passed: number; failed: string[] } {
  const failed = scores.filter((s) => !s.pass).map((s) => s.id);
  return { total: scores.length, passed: scores.length - failed.length, failed };
}
