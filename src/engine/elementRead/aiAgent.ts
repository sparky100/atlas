/**
 * AI on systems. An AI *agent* is a system with the optional `aiAutonomy`
 * attribute (ADR-001 amendment, PR #479); a system that uses AI without being
 * an agent has the optional `aiUse` attribute (built-in AI features, or an AI
 * model or service). A system "uses AI" if either is set, so nobody fills in
 * both for an agent. Everything that shows or counts AI reads the two fields
 * through here, so the answer is the same on every page. Pure.
 */
import { AI_AUTONOMY_LABELS, AI_AUTONOMY_OPTIONS, AI_USE_LABELS, AI_USE_OPTIONS } from '../../contracts/attributeSchema';
import type { AiAutonomy, AiUse } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { attributesRecord } from './attributesRecord';

type HasAttributes = Pick<ElementsHeadRow, 'attributes'>;

/** The stored value if it is one of the three known ones, else `null` (not an agent, or an unrecognised value). */
export function aiAutonomyOf(element: HasAttributes): AiAutonomy | null {
  const value = attributesRecord(element.attributes).aiAutonomy;
  return typeof value === 'string' && (AI_AUTONOMY_OPTIONS as readonly string[]).includes(value) ? (value as AiAutonomy) : null;
}

/** The recorded non-agent AI use, else `null`. */
export function aiUseOf(element: HasAttributes): AiUse | null {
  const value = attributesRecord(element.attributes).aiUse;
  return typeof value === 'string' && (AI_USE_OPTIONS as readonly string[]).includes(value) ? (value as AiUse) : null;
}

export function isAiAgent(element: HasAttributes): boolean {
  return aiAutonomyOf(element) !== null;
}

/** An agent, or a system with AI use recorded. */
export function usesAi(element: HasAttributes): boolean {
  return aiAutonomyOf(element) !== null || aiUseOf(element) !== null;
}

/** What to mark on a page: how an agent acts and/or how it uses AI, or `null` when neither is recorded. */
export interface AiMark {
  autonomy: AiAutonomy | null;
  use: AiUse | null;
}

export function aiMarkOf(element: HasAttributes): AiMark | null {
  const autonomy = aiAutonomyOf(element);
  const use = aiUseOf(element);
  return autonomy === null && use === null ? null : { autonomy, use };
}

/** "Suggests only" / "Acts with approval" / "Acts alone". */
export function aiAutonomyLabel(value: AiAutonomy): string {
  return AI_AUTONOMY_LABELS[value] ?? value;
}

/** "Built-in AI features" / "Uses an AI model or service". */
export function aiUseLabel(value: AiUse): string {
  return AI_USE_LABELS[value] ?? value;
}

/** Not an agent first (-1), then least to most free: suggests, acts with approval, acts alone. */
export function aiAutonomyRank(value: AiAutonomy | null): number {
  return value === null ? -1 : AI_AUTONOMY_OPTIONS.indexOf(value);
}

/** One ordering for everything using AI: nothing (-1), built-in AI (0), an AI service (1), then agents by how freely they act (2 to 4). */
export function aiRankOf(element: HasAttributes): number {
  const autonomy = aiAutonomyOf(element);
  if (autonomy !== null) return 2 + aiAutonomyRank(autonomy);
  const use = aiUseOf(element);
  return use === null ? -1 : AI_USE_OPTIONS.indexOf(use);
}

/** The single "how AI is used" value a report groups and filters on: `agent` for any agent, else the recorded use, else `null`. */
export type AiUseReportValue = 'agent' | AiUse;

export function aiUseReportValueOf(element: HasAttributes): AiUseReportValue | null {
  return isAiAgent(element) ? 'agent' : aiUseOf(element);
}

/** Report/column words for `AiUseReportValue`. */
export const AI_USE_REPORT_LABELS: Readonly<Record<string, string>> = { agent: 'AI agent', built_in: 'Built-in AI features', external_service: 'Uses an AI model or service' };

/** Short words for a column or chip: an agent reads as how it acts; anything else as its use. */
export function aiShortLabel(mark: AiMark): string {
  if (mark.autonomy !== null) return aiAutonomyLabel(mark.autonomy);
  return mark.use === 'built_in' ? 'Built-in AI' : 'AI service';
}
