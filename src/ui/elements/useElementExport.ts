import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { BrowseRow } from '../../db/elementBrowse';
import type { AttributeDefinitionRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { elementBrowseRowsToCsv, sanitizeForFilename } from './elementExport';
import { loadExportData, type LoadedExportData } from './loadExportData';
import { browseRowsToXlsxBlob } from './elementExportXlsx';

export type ElementExportStatus = 'idle' | 'working';

export interface UseElementExportInput {
  modelId: UUID;
  /** The commit the visible set was read at — facts/relationships/sources are loaded against this same commit. `null` while the model has no commits yet. */
  commitId: UUID | null;
  definitions: readonly AttributeDefinitionRow[];
  rows: readonly BrowseRow[];
  /** The filename's base fragment (a model or capability name). */
  filenameBase: string;
}

export interface UseElementExportResult {
  status: ElementExportStatus;
  error: string | null;
  exportCsv: () => Promise<void>;
  exportXlsx: () => Promise<void>;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * F8's export data + download. The visible set (`rows`) is already in hand;
 * this lazily loads the one-time extras an export needs — facts (for the
 * provenance summary), every element (to name relationship endpoints), the
 * `supports`/`uses`/`flows_to`/`owns` edges (the Relationships sheet), and
 * the model's sources (to resolve a source id to a name) — only when the
 * user actually clicks a download, never on every render.
 */
export function useElementExport({ modelId, commitId, definitions, rows, filenameBase }: UseElementExportInput): UseElementExportResult {
  const [status, setStatus] = useState<ElementExportStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<LoadedExportData | null> => {
    if (!commitId) return null;
    return loadExportData(supabase, modelId, commitId);
  }, [modelId, commitId]);

  const exportCsv = useCallback(async () => {
    setError(null);
    setStatus('working');
    try {
      const data = await load();
      if (!data) {
        setError('This model has no commits yet.');
        return;
      }
      const csv = elementBrowseRowsToCsv(rows, definitions, data.provenanceById, data.nameById);
      // A UTF-8 BOM so Excel (which otherwise guesses the system codepage for
      // a plain .csv) reliably reads non-ASCII names/values as UTF-8.
      downloadBlob(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' }), `${sanitizeForFilename(filenameBase)}-export.csv`);
    } catch (e) {
      reportError("Couldn't export.", e);
      setError(e instanceof Error ? e.message : 'Could not export.');
    } finally {
      setStatus('idle');
    }
  }, [load, rows, definitions, filenameBase]);

  const exportXlsx = useCallback(async () => {
    setError(null);
    setStatus('working');
    try {
      const data = await load();
      if (!data) {
        setError('This model has no commits yet.');
        return;
      }
      const blob = browseRowsToXlsxBlob(rows, definitions, data.provenanceById, data.relationships, data.nameById);
      downloadBlob(blob, `${sanitizeForFilename(filenameBase)}-export.xlsx`);
    } catch (e) {
      reportError("Couldn't export.", e);
      setError(e instanceof Error ? e.message : 'Could not export.');
    } finally {
      setStatus('idle');
    }
  }, [load, rows, definitions, filenameBase]);

  return { status, error, exportCsv, exportXlsx };
}
