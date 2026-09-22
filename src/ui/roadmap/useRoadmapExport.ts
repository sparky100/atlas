/**
 * The roadmap's own CSV/PNG export — unlike F8's `useElementExport.ts`,
 * nothing here needs an async load: the roadmap's own data (`groups`,
 * `branchEvents`) is already fully in memory by the time this page can
 * render at all (`useRoadmap.ts` loaded it), so both exports are plain
 * synchronous builds over the same filtered/moded visible set
 * `RoadmapView` itself renders.
 */
import { useCallback, useState } from 'react';
import type { RoadmapBranchEvents } from '../../db/roadmapChangeEvents';
import { sanitizeForFilename } from '../elements/elementExport';
import { reportError } from '../errors/errorBannerStore';
import { isRoadmapEligibleBranch, type RoadmapMode } from './roadmapEligibility';
import type { RoadmapFilters } from './roadmapFilter';
import type { RoadmapGroup } from './roadmapLifecycleRows';
import { roadmapToCsv } from './roadmapExport';
import { computeRoadmapPngPlan, roadmapPngPlanToDataUrl } from './roadmapPngExport';
import { computeRoadmapTimelineRange, computeRoadmapWindow, type RoadmapGranularity, type RoadmapHorizon, type RoadmapTimelineRange } from './roadmapTimelineScale';
import { computeRoadmapVisibleData } from './roadmapVisibleData';

export interface UseRoadmapExportInput {
  groups: readonly RoadmapGroup[];
  branchEvents: readonly RoadmapBranchEvents[];
  mode: RoadmapMode;
  filters: RoadmapFilters;
  granularity: RoadmapGranularity;
  horizon: RoadmapHorizon;
  /** The fixed-horizon window's left edge; `undefined` centers on now (ignored for `'all'`). */
  windowStart: Date | undefined;
  /** The model/view name, for the filename — same role `useElementExport.ts`'s own `filenameBase` plays. */
  filenameBase: string;
  now?: Date;
}

export interface UseRoadmapExportResult {
  error: string | null;
  exportCsv: () => void;
  exportPng: () => void;
}

function downloadUrl(href: string, filename: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  URL.revokeObjectURL(url);
}

/** Same `allDatesFor` shape `RoadmapView.tsx` computes, so the exported timeline range matches what's on screen exactly. */
function allDatesFor(groups: readonly RoadmapGroup[], branchEvents: readonly RoadmapBranchEvents[], mode: RoadmapMode): (string | undefined)[] {
  const dates: (string | undefined)[] = [];
  for (const group of groups) {
    for (const bar of group.bars) dates.push(bar.introduced, bar.plannedEnd, bar.supportEndsAt);
  }
  for (const { branch } of branchEvents) {
    if (isRoadmapEligibleBranch(branch, mode)) dates.push(branch.target_date ?? undefined);
  }
  return dates;
}

export function useRoadmapExport({ groups, branchEvents, mode, filters, granularity, horizon, windowStart, filenameBase, now = new Date() }: UseRoadmapExportInput): UseRoadmapExportResult {
  const [error, setError] = useState<string | null>(null);

  const exportCsv = useCallback(() => {
    setError(null);
    try {
      const { filteredGroups, eligibleEvents } = computeRoadmapVisibleData(groups, branchEvents, mode, filters, now);
      const csv = roadmapToCsv(filteredGroups, eligibleEvents);
      // A UTF-8 BOM, same reasoning `useElementExport.ts`'s own CSV download uses — Excel otherwise guesses a system codepage for non-ASCII names.
      downloadBlob(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' }), `${sanitizeForFilename(filenameBase)}-roadmap.csv`);
    } catch (e) {
      reportError("Couldn't export the roadmap table.", e);
      setError(e instanceof Error ? e.message : 'Could not export.');
    }
  }, [groups, branchEvents, mode, filters, now, filenameBase]);

  const exportPng = useCallback(() => {
    setError(null);
    try {
      const fullRange: RoadmapTimelineRange = computeRoadmapTimelineRange(allDatesFor(groups, branchEvents, mode), now);
      const range = computeRoadmapWindow(horizon, fullRange, now, windowStart);
      const plan = computeRoadmapPngPlan(groups, branchEvents, mode, filters, granularity, range, now);
      const dataUrl = roadmapPngPlanToDataUrl(plan);
      downloadUrl(dataUrl, `${sanitizeForFilename(filenameBase)}-roadmap.png`);
    } catch (e) {
      reportError("Couldn't export the roadmap image.", e);
      setError(e instanceof Error ? e.message : 'Could not export.');
    }
  }, [groups, branchEvents, mode, filters, granularity, horizon, windowStart, now, filenameBase]);

  return { error, exportCsv, exportPng };
}
