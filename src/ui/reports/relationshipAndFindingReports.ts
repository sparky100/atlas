import type { UUID } from '../../contracts/delta';
import { REPORT_SPEC_VERSION, type ReportSpec } from '../../contracts/reportSpec';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { Client } from '../../db/client';
import { FINDING_FILTER_OPTIONS, listAllElements } from '../../db/elementBrowse';
import { listAllRelationships } from '../../db/elements';
import { listFactsForCommit } from '../../db/healthFindings';
import { computeFindings } from '../../db/modelFindings';
import { getStaleAfterMonthsForCommit } from '../../db/organisations';
import { attributesRecord } from '../../engine/elementRead/attributesRecord';
import { moduleDisplayName } from '../../engine/elementRead/moduleDisplayName';
import { withReportLinks, type LiveReportRow } from './reportRowLinks';

const RELATIONSHIP_COLUMNS = ['from', 'type', 'to', 'description'] as const;
const FINDING_COLUMNS = ['finding', 'name', 'type', 'criticality'] as const;
export const RELATIONSHIP_REPORT_FIELDS = ['id', ...RELATIONSHIP_COLUMNS] as const;
export const FINDING_REPORT_FIELDS = ['id', 'findingKey', ...FINDING_COLUMNS] as const;

export function relationshipReportRows(elements: readonly ElementsHeadRow[], relationships: readonly RelationshipsHeadRow[]): LiveReportRow[] {
  const byId = new Map(elements.map((element) => [element.element_id, element]));
  return relationships.map((row) => {
    const from = byId.get(row.from_element_id);
    const to = byId.get(row.to_element_id);
    const description = attributesRecord(row.attributes).description;
    return withReportLinks({
      id: row.relationship_id,
      from: from ? moduleDisplayName(from, byId.get(from.parent_id ?? '') ?? null) : null,
      to: to ? moduleDisplayName(to, byId.get(to.parent_id ?? '') ?? null) : null,
      type: row.relationship_type,
      description: typeof description === 'string' ? description : null,
    }, {
      ...(from ? {
        from: { elementId: from.element_id },
        type: { elementId: from.element_id, relationshipId: row.relationship_id },
      } : {}),
      ...(to ? { to: { elementId: to.element_id } } : {}),
    });
  });
}

export function findingReportRows(elements: readonly ElementsHeadRow[], findings: ReadonlyMap<string, readonly ElementsHeadRow[]>): LiveReportRow[] {
  const byId = new Map(elements.map((element) => [element.element_id, element]));
  return FINDING_FILTER_OPTIONS.flatMap(({ value, label }) => {
    const unique = new Map((findings.get(value) ?? []).map((element) => [element.element_id, element]));
    return [...unique.values()].map((element) => {
      const criticality = attributesRecord(element.attributes).criticality;
      return withReportLinks({
        id: `${value}:${element.element_id}`,
        findingKey: value,
        finding: label,
        name: moduleDisplayName(element, byId.get(element.parent_id ?? '') ?? null),
        type: element.element_type,
        criticality: typeof criticality === 'string' ? criticality : null,
      }, { name: { elementId: element.element_id } });
    });
  });
}

export async function loadRelationshipReportRows(client: Client, commitId: UUID): Promise<LiveReportRow[]> {
  const [elements, relationships] = await Promise.all([listAllElements(client, commitId), listAllRelationships(client, commitId)]);
  return relationshipReportRows(elements, relationships);
}

export async function loadFindingReportRows(client: Client, commitId: UUID): Promise<LiveReportRow[]> {
  const now = new Date();
  const [elements, relationships, facts, staleAfterMonths] = await Promise.all([
    listAllElements(client, commitId), listAllRelationships(client, commitId), listFactsForCommit(client, commitId), getStaleAfterMonthsForCommit(client, commitId),
  ]);
  return findingReportRows(elements, computeFindings({ snapshot: { elements, relationships }, facts, now, staleAfterMonths }));
}

interface StarterReport {
  name: string;
  spec: ReportSpec;
}

const relationshipSpec: ReportSpec = {
  specVersion: REPORT_SPEC_VERSION, source: 'relationships', columns: RELATIONSHIP_COLUMNS, filters: [],
  sort: [{ field: 'from', direction: 'asc' }, { field: 'to', direction: 'asc' }], presentation: { kind: 'table' },
};
const findingSpec: ReportSpec = {
  specVersion: REPORT_SPEC_VERSION, source: 'findings', columns: FINDING_COLUMNS, filters: [],
  sort: [{ field: 'finding', direction: 'asc' }, { field: 'name', direction: 'asc' }], presentation: { kind: 'table' },
};

export const STARTER_REPORTS: readonly StarterReport[] = [
  { name: 'All relationships', spec: relationshipSpec },
  { name: 'Capability support', spec: { ...relationshipSpec, filters: [{ field: 'type', operator: 'eq', value: 'supports' }] } },
  { name: 'Current model findings', spec: findingSpec },
  { name: 'Critical systems with no business owner', spec: { ...findingSpec, filters: [{ field: 'findingKey', operator: 'eq', value: 'critical-no-business-owner' }] } },
];
