/**
 * Plan A3: open projects as bars on the Roadmap's "By capability" view.
 *
 * Derived, nothing stored (CLAUDE.md rules 2 and 3): a project sits on the
 * level-1 capability domain of every capability its declared scope names,
 * spanning its own start and target dates. A project with no dates, or whose
 * scope names no capability yet, has nowhere to sit — it is returned in
 * `unplaced` so the page can list it rather than silently leave it off.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { l1AncestorOf } from '../elements/capabilityDepth';
import type { RoadmapGroup } from './roadmapLifecycleRows';

export interface RoadmapProjectBar {
  projectId: UUID;
  title: string;
  href: string;
  /** `start_date`; `undefined` when not recorded (the bar then has no left edge, never defaulted to today). */
  start: string | undefined;
  /** `target_date`; `undefined` when not recorded (no right edge). */
  target: string | undefined;
}

export interface RoadmapUnplacedProject {
  projectId: UUID;
  title: string;
  href: string;
  /** Why it has no place on the plan — shown beside it in plain words. */
  reason: 'no-dates' | 'no-capability';
}

export interface ProjectBarsInput {
  projects: readonly { id: UUID; title: string; status: string; start_date: string | null; target_date: string | null }[];
  /** Declared-scope element links of open projects (`listOpenProjectScopeForModel`). */
  scope: readonly { projectId: UUID; elementId: UUID }[];
  capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>;
  elementHref: (id: UUID) => string;
  projectHref: (id: UUID) => string;
}

export function attachProjectBars(groups: readonly RoadmapGroup[], input: ProjectBarsInput): { groups: RoadmapGroup[]; unplaced: RoadmapUnplacedProject[] } {
  const { projects, scope, capabilitiesById, elementHref, projectHref } = input;
  const domainsByProject = new Map<UUID, Set<UUID>>();
  for (const link of scope) {
    const l1 = capabilitiesById.has(link.elementId) ? l1AncestorOf(link.elementId, capabilitiesById) : null;
    if (l1 === null) continue;
    const set = domainsByProject.get(link.projectId) ?? new Set<UUID>();
    set.add(l1.element_id);
    domainsByProject.set(link.projectId, set);
  }

  const barsByDomain = new Map<UUID, RoadmapProjectBar[]>();
  const unplaced: RoadmapUnplacedProject[] = [];
  for (const project of projects) {
    if (project.status !== 'active' && project.status !== 'on_hold') continue;
    const href = projectHref(project.id);
    const domains = domainsByProject.get(project.id);
    if (domains === undefined || domains.size === 0) {
      unplaced.push({ projectId: project.id, title: project.title, href, reason: 'no-capability' });
      continue;
    }
    if (project.start_date === null && project.target_date === null) {
      unplaced.push({ projectId: project.id, title: project.title, href, reason: 'no-dates' });
      continue;
    }
    const bar: RoadmapProjectBar = { projectId: project.id, title: project.title, href, start: project.start_date ?? undefined, target: project.target_date ?? undefined };
    for (const domainId of domains) {
      const list = barsByDomain.get(domainId) ?? [];
      list.push(bar);
      barsByDomain.set(domainId, list);
    }
  }
  const byStart = (a: RoadmapProjectBar, b: RoadmapProjectBar): number => (a.start ?? a.target ?? '').localeCompare(b.start ?? b.target ?? '') || a.title.localeCompare(b.title);

  const merged: RoadmapGroup[] = groups.map((group) => {
    const bars = barsByDomain.get(group.key);
    return bars === undefined ? group : { ...group, projectBars: [...bars].sort(byStart) };
  });
  // A domain with projects but no dated system yet still gets its own row.
  const existing = new Set(groups.map((group) => group.key));
  const extra: RoadmapGroup[] = [...barsByDomain.entries()]
    .filter(([domainId]) => !existing.has(domainId))
    .flatMap(([domainId, bars]) => {
      const domain = capabilitiesById.get(domainId);
      return domain === undefined ? [] : [{ key: domainId, label: domain.name, href: elementHref(domainId), bars: [], projectBars: [...bars].sort(byStart) }];
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  unplaced.sort((a, b) => a.title.localeCompare(b.title));
  return { groups: [...merged, ...extra], unplaced };
}
