import type { UUID } from '../../contracts/delta';
import type { ReportRow } from '../../contracts/reportSpec';

const links = Symbol('report record links');

export interface ReportRecordLink {
  elementId: UUID;
  relationshipId?: UUID;
}

type CellLinks = Readonly<Partial<Record<string, ReportRecordLink>>>;
export type LiveReportRow = ReportRow & { [links]?: CellLinks };

export function withReportLinks(row: ReportRow, cellLinks: CellLinks): LiveReportRow {
  return { ...row, [links]: cellLinks };
}

export function reportCellHref(row: LiveReportRow | undefined, field: string, basePath: string): string | undefined {
  const cellLinks = row?.[links];
  const link = cellLinks !== undefined && Object.hasOwn(cellLinks, field) ? cellLinks[field] : undefined;
  if (link === undefined) return undefined;
  const hash = link.relationshipId === undefined ? '' : `#relationship-${encodeURIComponent(link.relationshipId)}`;
  return `${basePath}/e/${encodeURIComponent(link.elementId)}?ref=main${hash}`;
}
