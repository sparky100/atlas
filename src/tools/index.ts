/**
 * ADR-028 §1: the model tools, in the order they are offered. Read-only, all
 * of them. `callTool` is the one entry point: an unknown tool or bad input
 * comes back as an error result the assistant can read, never as a throw.
 */
import { findElements } from './findElements';
import { getElement } from './getElement';
import { listRelationships } from './listRelationships';
import { listSavedReports, runSavedReport } from './savedReports';
import { searchElements } from './searchElements';
import type { ModelTool, ToolContext, ToolResult } from './types';

export const MODEL_TOOLS: readonly ModelTool[] = [searchElements, getElement, listRelationships, findElements, listSavedReports, runSavedReport];

export function callTool(ctx: ToolContext, name: string, input: unknown): Promise<ToolResult> {
  const tool = MODEL_TOOLS.find((t) => t.name === name);
  if (!tool) return Promise.resolve({ ok: false, error: `There is no tool called "${name.slice(0, 60)}". Available: ${MODEL_TOOLS.map((t) => t.name).join(', ')}.` });
  return tool.run(ctx, input);
}

export type { ModelSnapshot, ModelTool, ToolContext, ToolResult, ToolStamp } from './types';
