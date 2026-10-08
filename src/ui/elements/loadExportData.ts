/**
 * The one-time extras an export needs beyond the visible rows (F8): facts
 * (the provenance summary), every element (to name relationship endpoints
 * and parents), the `supports`/`uses`/`flows_to`/`owns` edges (the
 * Relationships sheet) and the model's sources. Split out of
 * `useElementExport.ts` so the very same loader runs in the app and in
 * `src/capture/exportImportRoundTrip.integration.test.ts` — which takes a
 * `Client`, where the hook's module imports the browser's own singleton.
 */
import type { UUID } from '../../contracts/delta';
import type { Client } from '../../db/client';
import { listAllElements } from '../../db/elementBrowse';
import { listAllOwnsEdges, listAllUsesAndFlowsToEdges, listFactsForCommit } from '../../db/healthFindings';
import { listAllSupportsEdges } from '../../db/modelHome';
import { listSourcesForModel } from '../../db/sources';
import { buildProvenanceById, relationshipExportRows, type ExportProvenance, type RelationshipExportRow } from './elementExport';

export interface LoadedExportData {
  provenanceById: Map<UUID, ExportProvenance>;
  relationships: RelationshipExportRow[];
  /** Every element's name by id — the parent columns look a parent up here, not in the (possibly filtered) visible set. */
  nameById: Map<UUID, string>;
}

export async function loadExportData(supabase: Client, modelId: UUID, commitId: UUID): Promise<LoadedExportData> {
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
    nameById: new Map(elements.map((e) => [e.element_id, e.name])),
  };
}
