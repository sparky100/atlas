import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { BrowseRow } from '../../db/elementBrowse';
import { listAllElements } from '../../db/elementBrowse';
import { listAllOwnsEdges, listAllUsesAndFlowsToEdges, listFactsForCommit } from '../../db/healthFindings';
import { listAllSupportsEdges } from '../../db/modelHome';
import { listSourcesForModel } from '../../db/sources';
import type { AttributeDefinitionRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { buildProvenanceById, elementBrowseRowsToCsv, relationshipExportRows, sanitizeForFilename, type ExportProvenance, type RelationshipExportRow } from './elementExport';
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

interface LoadedExportData {
  provenanceById: Map<UUID, ExportProvenance>;
  relationships: RelationshipExportRow[];
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
    const [facts, elements, supports, usesFlowsTo, owns, sources] = await Promise.all([
      listFactsForCommit(supabase, commitId),
      listAllElements(supabase, commitId),
      listAllSupportsEdges(supabase, commitId),
      listAllUsesAndFlowsToEdges(supabase, commitId),
      listAllOwnsEdges(supabase, commitId),
      listSourcesForModel(supabase, modelId),
    ]);
    const elementsById = new Map(elements.map((e) => [e.element_id, e]));
    const sourcesById = new Map(sources.map((s) => [s.id, s]));
    return {
      provenanceById: buildProvenanceById(facts, sourcesById, new Date()),
      relationships: relationshipExportRows([...supports, ...usesFlowsTo, ...owns], elementsById),
    };
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
      const csv = elementBrowseRowsToCsv(rows, definitions, data.provenanceById);
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
      const blob = browseRowsToXlsxBlob(rows, definitions, data.provenanceById, data.relationships);
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
