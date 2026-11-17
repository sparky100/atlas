/**
 * ADR-028 §1: the work records beside the model: changes, decisions and
 * projects, and (ADR-035) goals. Summaries only; the ids are named `changeId`, `decisionId`,
 * `projectId` and `goalId` (never `id`) because they are not elements and must not be
 * citable as elements. Comments and capture drafts are not exposed.
 */
import { z } from 'zod';
import type { BranchRow } from '../db/types';
import { OPEN_CHANGE_STATUSES } from '../db/branches';
import { clip, MAX_TOOL_ROWS, DEFAULT_TOOL_ROWS } from './limits';
import { defineTool, elementRef, failure, indexSnapshot, okResult, uuidInput } from './toolKit';

const OPEN = new Set<string>(OPEN_CHANGE_STATUSES);
const limitInput = z.number().int().min(1).max(MAX_TOOL_ROWS).default(DEFAULT_TOOL_ROWS);

function changeSummary(b: BranchRow) {
  return {
    changeId: b.id,
    title: clip(b.title ?? b.name, 200),
    status: b.status,
    intent: b.intent,
    targetDate: b.target_date,
    projectId: b.project_id,
    description: b.description === null ? null : clip(b.description, 300),
  };
}

export const listChanges = defineTool({
  name: 'list_changes',
  description: 'List changes: proposed edits to the model that have not yet gone live (draft, proposed, in review, approved), or all of them including merged and ended ones. Returns changeId, title, status, intent, target date and project. Use change_impact to see what one touches.',
  schema: z.strictObject({ scope: z.enum(['open', 'all']).default('open'), limit: limitInput }),
  run: async (ctx, input) => {
    const all = (await ctx.changes()).filter((b) => input.scope === 'all' || OPEN.has(b.status));
    const shown = all.slice(0, input.limit).map(changeSummary);
    return okResult(ctx, { changes: shown }, all.length, all.length > shown.length);
  },
});

export const changeImpact = defineTool({
  name: 'change_impact',
  description: 'What one change touches and who it affects: the elements it adds, edits or removes, the capabilities and value streams affected, and other open changes touching the same elements. Takes a changeId from list_changes. Reads the change against the live model without changing it.',
  schema: z.strictObject({ changeId: uuidInput }),
  run: async (ctx, input) => {
    const change = (await ctx.changes()).find((b) => b.id === input.changeId);
    if (!change) return failure('No change with that changeId that you can see. Use list_changes.');
    const summary = await ctx.changeImpact(change);
    if (!summary) return okResult(ctx, { change: changeSummary(change), note: 'This change has not made any edits of its own yet.' });

    const touched = summary.subjects.map((s) =>
      s.subjectType === 'element' ? { id: s.subjectId, type: s.elementType, name: clip(s.name, 200) } : { relationship: s.relationshipType, name: clip(s.name, 200) },
    );
    const capabilities = summary.affectedCapabilities.map((a) => ({
      id: a.capability.element_id,
      type: a.capability.element_type,
      name: clip(a.capability.name, 200),
      viaSystems: a.viaSystems.slice(0, 10).map((v) => ({ id: v.element_id, type: v.element_type, name: clip(v.name, 200) })),
      reasons: a.reasons.slice(0, 5),
    }));
    const streams = summary.affectedValueStreams.map((v) => ({ id: v.stream.element_id, type: v.stream.element_type, name: clip(v.stream.name, 200), stages: v.stages.length }));
    const others = summary.otherOpenChanges.map((o) => ({ ...changeSummary(o.branch), sharedElements: o.sharedElementNames.slice(0, 10).map((n) => clip(n, 200)) }));

    const total = touched.length + capabilities.length + streams.length;
    const truncated = touched.length > MAX_TOOL_ROWS || capabilities.length > MAX_TOOL_ROWS || streams.length > MAX_TOOL_ROWS || others.length > MAX_TOOL_ROWS;
    return okResult(
      ctx,
      {
        change: changeSummary(change),
        touched: touched.slice(0, MAX_TOOL_ROWS),
        affectedCapabilities: capabilities.slice(0, MAX_TOOL_ROWS),
        affectedValueStreams: streams.slice(0, MAX_TOOL_ROWS),
        otherOpenChanges: others.slice(0, MAX_TOOL_ROWS),
        counts: { touched: touched.length, affectedCapabilities: capabilities.length, affectedValueStreams: streams.length, otherOpenChanges: others.length },
      },
      total,
      truncated,
    );
  },
});

export const listDecisions = defineTool({
  name: 'list_decisions',
  description: 'List decisions recorded about the model: title, status (proposed = still open, accepted, superseded, rejected = cancelled), when it is needed by, a short statement, and the elements an open decision concerns.',
  schema: z.strictObject({ status: z.enum(['proposed', 'accepted', 'superseded', 'rejected']).optional(), limit: limitInput }),
  run: async (ctx, input) => {
    const all = (await ctx.decisions()).filter((d) => input.status === undefined || d.status === input.status);
    const shownRows = all.slice(0, input.limit);
    const links = await ctx.openDecisionLinks();
    const index = indexSnapshot(await ctx.snapshot());
    const shown = shownRows.map((d) => ({
      decisionId: d.id,
      title: clip(d.title, 200),
      status: d.status,
      neededBy: d.needed_by,
      decidedAt: d.decided_at,
      projectId: d.project_id,
      statement: clip(d.statement, 300),
      concerns: links
        .filter((l) => l.decisionId === d.id)
        .slice(0, 10)
        .flatMap((l) => {
          const el = index.byId.get(l.elementId);
          return el ? [elementRef(index, el)] : [];
        }),
    }));
    return okResult(ctx, { decisions: shown }, all.length, all.length > shown.length);
  },
});

export const listProjects = defineTool({
  name: 'list_projects',
  description: 'List projects: title, purpose, status (active, on hold, closed, cancelled), start and target dates.',
  schema: z.strictObject({ status: z.enum(['active', 'on_hold', 'closed', 'cancelled']).optional(), limit: limitInput }),
  run: async (ctx, input) => {
    const all = (await ctx.projects()).filter((p) => input.status === undefined || p.status === input.status);
    const shown = all.slice(0, input.limit).map((p) => ({
      projectId: p.id,
      title: clip(p.title, 200),
      purpose: clip(p.purpose, 300),
      status: p.status,
      startDate: p.start_date,
      targetDate: p.target_date,
    }));
    return okResult(ctx, { projects: shown }, all.length, all.length > shown.length);
  },
});

export const listGoals = defineTool({
  name: 'list_goals',
  description: 'List the goals the organisation is working towards: title, what success looks like, why now, and the capabilities that serve each goal. Use it to answer why a capability matters. Retired goals are left out unless asked for.',
  schema: z.strictObject({ status: z.enum(['active', 'retired']).default('active'), limit: limitInput }),
  run: async (ctx, input) => {
    const all = (await ctx.goals()).filter((g) => g.status === input.status);
    const shownRows = all.slice(0, input.limit);
    const links = await ctx.goalLinks();
    const index = indexSnapshot(await ctx.snapshot());
    const shown = shownRows.map((g) => ({
      goalId: g.id,
      title: clip(g.title, 200),
      status: g.status,
      statement: clip(g.statement, 300),
      whyNow: g.why_now === '' ? null : clip(g.why_now, 300),
      capabilities: links
        .filter((l) => l.goal_id === g.id)
        .slice(0, 25)
        .flatMap((l) => {
          const el = index.byId.get(l.capability_id);
          return el ? [elementRef(index, el)] : [];
        }),
    }));
    return okResult(ctx, { goals: shown }, all.length, all.length > shown.length);
  },
});
