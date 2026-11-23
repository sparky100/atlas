import type { CapabilitySetOption, CatalogueProductContent, CatalogueVersionSummary } from '../../contracts/catalogueAdmin';

/** The label this admin UI uses everywhere for a sector id. */
export function sectorLabel(sector: string): string {
  return sector.replaceAll('_', ' ');
}

/** One capability-set version, named for a product's link and the draft's pinned-set picker. */
export function setLabel(set: CapabilitySetOption): string {
  return `${sectorLabel(set.sector)} · ${set.title ?? 'Capability set'} · v${String(set.version)}${set.status === 'published' ? '' : ` (${set.status})`}`;
}

/** The blank editable product a new-product page starts from. */
export function emptyProduct(): CatalogueProductContent {
  return { code: '', product: '', vendor: '', summary: '', capabilities: [], claims: [] };
}

/** The highest published, non-withdrawn catalogue version for one sector. */
export function currentCatalogueVersion(versions: readonly CatalogueVersionSummary[], sector: string): CatalogueVersionSummary | null {
  return versions
    .filter((version) => version.sector === sector && version.status === 'published' && version.withdrawn_at === null)
    .sort((a, b) => b.version - a.version)[0] ?? null;
}
