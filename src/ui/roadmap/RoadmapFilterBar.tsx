import type { Criticality, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { Chip } from '../components/Chip/Chip';
import { EMPTY_ROADMAP_FILTERS, hasActiveRoadmapFilters, type RoadmapFilters } from './roadmapFilter';
import { type RoadmapGroupBy } from './roadmapFilterParams';
import type { RoadmapMode } from './roadmapEligibility';
import styles from './RoadmapFilterBar.module.css';

const CRITICALITY_OPTIONS: readonly { value: Criticality; label: string }[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export interface RoadmapFilterBarProps {
  filters: RoadmapFilters;
  onFiltersChange: (filters: RoadmapFilters) => void;
  mode: RoadmapMode;
  onModeChange: (mode: RoadmapMode) => void;
  /** F6 Step 6: which grouping the timeline shows — capability (default) or value stream. */
  groupBy: RoadmapGroupBy;
  onGroupByChange: (groupBy: RoadmapGroupBy) => void;
  capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>;
  ownerActorsById: ReadonlyMap<UUID, ElementsHeadRow>;
}

function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

interface Facet<T extends string> {
  title: string;
  values: readonly T[];
  options: readonly { value: T; label: string }[];
  onToggle: (value: T) => void;
}

/** Same shape as `LandscapeFilterBar.tsx`'s own local `FacetDisclosure` — not yet extracted into a shared component (this is the second, not third, caller; extracting on a rule-of-two would be premature here). */
function FacetDisclosure<T extends string>({ title, values, options, onToggle }: Facet<T>) {
  return (
    <details className={styles.facet}>
      <summary className={styles.summary}>
        {title}
        {values.length > 0 ? ` (${String(values.length)})` : ''}
      </summary>
      <div className={styles.options}>
        {options.map((option) => (
          <label key={option.value} className={styles.option}>
            <input
              type="checkbox"
              checked={values.includes(option.value)}
              onChange={() => {
                onToggle(option.value);
              }}
            />
            {option.label}
          </label>
        ))}
      </div>
    </details>
  );
}

/**
 * F5's own "filters (capability, owner, criticality, contracts ending)"
 * and "as-is/to-be" (docs/prompts/atlas-prompt-pack.md). "Contracts
 * ending" reads "Support ending" here and maps to `supportEndsAt`
 * (`roadmapFilter.ts`'s own module comment: no contract entity exists in
 * this model). As-is/to-be is a plain two-button toggle, not
 * `BranchViewModeControl` — that component picks a side of *one* branch's
 * own fork; this picks which *set of branches* the whole roadmap
 * includes (`roadmapEligibility.ts`'s own module comment).
 */
export function RoadmapFilterBar({ filters, onFiltersChange, mode, onModeChange, groupBy, onGroupByChange, capabilitiesById, ownerActorsById }: RoadmapFilterBarProps) {
  const active = hasActiveRoadmapFilters(filters);
  const capabilityOptions = [...capabilitiesById.values()].map((c) => ({ value: c.element_id, label: c.name })).sort((a, b) => a.label.localeCompare(b.label));
  const ownerOptions = [...ownerActorsById.values()].map((a) => ({ value: a.element_id, label: a.name })).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className={styles.bar}>
      <div className={styles.modeToggle} role="group" aria-label="Roadmap state">
        <button type="button" className={mode === 'asIs' ? styles.modeActive : styles.mode} aria-pressed={mode === 'asIs'} onClick={() => { onModeChange('asIs'); }}>
          As-is
        </button>
        <button type="button" className={mode === 'toBe' ? styles.modeActive : styles.mode} aria-pressed={mode === 'toBe'} onClick={() => { onModeChange('toBe'); }}>
          To-be
        </button>
      </div>
      <div className={styles.modeToggle} role="group" aria-label="Roadmap grouping">
        <button type="button" className={groupBy === 'capability' ? styles.modeActive : styles.mode} aria-pressed={groupBy === 'capability'} onClick={() => { onGroupByChange('capability'); }}>
          By capability
        </button>
        <button type="button" className={groupBy === 'valueStream' ? styles.modeActive : styles.mode} aria-pressed={groupBy === 'valueStream'} onClick={() => { onGroupByChange('valueStream'); }}>
          By value stream
        </button>
      </div>
      <div className={styles.facets} aria-label="Roadmap filters">
        <FacetDisclosure
          title="Capability"
          values={filters.capabilityIds}
          options={capabilityOptions}
          onToggle={(value) => {
            onFiltersChange({ ...filters, capabilityIds: toggled(filters.capabilityIds, value) });
          }}
        />
        <FacetDisclosure
          title="Owner"
          values={filters.ownerIds}
          options={ownerOptions}
          onToggle={(value) => {
            onFiltersChange({ ...filters, ownerIds: toggled(filters.ownerIds, value) });
          }}
        />
        <FacetDisclosure
          title="Criticality"
          values={filters.criticalities}
          options={CRITICALITY_OPTIONS}
          onToggle={(value) => {
            onFiltersChange({ ...filters, criticalities: toggled(filters.criticalities, value) });
          }}
        />
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={filters.supportEndingSoon}
            onChange={() => {
              onFiltersChange({ ...filters, supportEndingSoon: !filters.supportEndingSoon });
            }}
          />
          Support ending soon
        </label>
        {active && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => {
              onFiltersChange(EMPTY_ROADMAP_FILTERS);
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      {active && (
        <div className={styles.activeChips}>
          {filters.capabilityIds.map((id) => (
            <Chip key={`capability-${id}`}>{capabilitiesById.get(id)?.name ?? id}</Chip>
          ))}
          {filters.ownerIds.map((id) => (
            <Chip key={`owner-${id}`}>{ownerActorsById.get(id)?.name ?? id}</Chip>
          ))}
          {filters.criticalities.map((value) => (
            <Chip key={`criticality-${value}`}>{CRITICALITY_OPTIONS.find((o) => o.value === value)?.label ?? value}</Chip>
          ))}
          {filters.supportEndingSoon && <Chip key="supportEnding">Support ending soon</Chip>}
        </div>
      )}
    </div>
  );
}
