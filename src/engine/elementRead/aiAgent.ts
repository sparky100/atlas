/**
 * AI agents are ordinary systems with the optional `aiAutonomy` attribute
 * (ADR-001 amendment, PR #479). Everything that shows or counts agents reads
 * the field through here, so "is this an agent, and how freely does it act"
 * has one answer on every page. Pure.
 */
import { AI_AUTONOMY_LABELS, AI_AUTONOMY_OPTIONS } from '../../contracts/attributeSchema';
import type { AiAutonomy } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { attributesRecord } from './attributesRecord';

/** The stored value if it is one of the three known ones, else `null` (not an agent, or an unrecognised value). */
export function aiAutonomyOf(element: Pick<ElementsHeadRow, 'attributes'>): AiAutonomy | null {
  const value = attributesRecord(element.attributes).aiAutonomy;
  return typeof value === 'string' && (AI_AUTONOMY_OPTIONS as readonly string[]).includes(value) ? (value as AiAutonomy) : null;
}

export function isAiAgent(element: Pick<ElementsHeadRow, 'attributes'>): boolean {
  return aiAutonomyOf(element) !== null;
}

/** "Suggests only" / "Acts with approval" / "Acts alone". */
export function aiAutonomyLabel(value: AiAutonomy): string {
  return AI_AUTONOMY_LABELS[value] ?? value;
}

/** Not an agent first (-1), then least to most free: suggests, acts with approval, acts alone. */
export function aiAutonomyRank(value: AiAutonomy | null): number {
  return value === null ? -1 : AI_AUTONOMY_OPTIONS.indexOf(value);
}
