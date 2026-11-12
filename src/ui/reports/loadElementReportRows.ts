/**
 * ADR-027 (F14 step 5): the `elements` source's rows for a saved report run
 * on its own page, read at one commit. Same commit-scoped bulk reads the
 * Elements page makes (`listAllElements`, owners from the `owns` edges),
 * filtered and ordered client-side by the evaluator (rule 8: no `.in()`).
 */
import type { UUID } from '../../contracts/delta';
import { listAllElements, loadOwnersByElementId } from '../../db/elementBrowse';
import type { Client } from '../../db/client';
import { buildBrowseRows } from '../elements/buildBrowseRows';
import { elementReportRow } from './elementsReport';
import { withReportLinks, type LiveReportRow } from './reportRowLinks';

export async function loadElementReportRows(supabase: Client, commitId: UUID): Promise<LiveReportRow[]> {
  const elements = await listAllElements(supabase, commitId);
  const owners = await loadOwnersByElementId(supabase, commitId, new Map(elements.map((e) => [e.element_id, e])));
  return buildBrowseRows(elements, owners).map((row) => withReportLinks(elementReportRow(row), {
    name: { elementId: row.element.element_id },
    ...(row.owner === null ? {} : { owner: { elementId: row.owner.element_id } }),
  }));
}
