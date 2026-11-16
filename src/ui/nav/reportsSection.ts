import type { BreadcrumbSegment } from '../components/Breadcrumb/Breadcrumb';

/** The Reports hub step — every page the left menu files under Reports shows it (`modelNavSection.ts`'s `reports`). */
export function reportsSection(orgSlug: string, modelSlug: string): BreadcrumbSegment {
  return { label: 'Reports', href: `/o/${orgSlug}/m/${modelSlug}/reports` };
}
