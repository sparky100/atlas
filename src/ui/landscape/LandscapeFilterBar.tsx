import type { Criticality, LifecycleStatus, SystemDomain, SystemKind, UUID } from '../../contracts/delta';
import { Chip } from '../components/Chip/Chip';
import { SYSTEM_KIND_LABEL } from '../elements/systemKind';
import { EMPTY_LANDSCAPE_FILTERS, hasActiveLandscapeFilters, type LandscapeFilters } from './landscapeFilter';
import styles from './LandscapeFilterBar.module.css';

const LIFECYCLE_OPTIONS: readonly { value: LifecycleStatus; label: string }[] = [
  { value: 'planned', label: 'Planned' },
  { value: 'active', label: 'Active' },
  { value: 'retiring', label: 'Retiring' },
  { value: 'retired', label: 'Retired' },
];
const CRITICALITY_OPTIONS: readonly { value: Criticality; label: string }[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];
const KIND_OPTIONS: readonly { value: SystemKind; label: string }[] = (Object.keys(SYSTEM_KIND_LABEL) as SystemKind[]).map((value) => ({ value, label: SYSTEM_KIND_LABEL[value] }));
const DOMAIN_OPTIONS: readonly { value: SystemDomain; label: string }[] = [
  { value: 'it', label: 'IT' },
  { value: 'ot', label: 'OT' },
  { value: 'hybrid', label: 'Hybrid' },
];

export interface LandscapeFilterBarProps {
  filters: LandscapeFilters;
  onChange: (filters: LandscapeFilters) => void;
  /** Every level-1 capability lane in the model — the whole universe of choices, independent of any filter currently active (`LandscapePage.tsx` builds this from `l1AncestorByCapabilityId`, the raw unfiltered fetch, not the current filtered layout, so a lane a filter has hidden is still offered here). */
  capabilityOptions: readonly { id: UUID; name: string }[];
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
 * V2 "landscape focus and filters": capability (multi)/lifecycle/
 * criticality/kind/domain — every filter narrows the canvas to matches
 * only (`LandscapePage.tsx` feeds `filters` into `useLandscapeDisplay`,
 * which removes non-matching systems before layout runs at all, so lane
 * emptiness/height/edge geometry all reflect the reduced set). A plain
 * checkbox list per facet, not a native `<select multiple>` (poor touch/
 * keyboard target, and used nowhere else in this app) — `<details>`/
 * `<summary>` disclosures, the same precedent `ReviewRequestView.tsx`
 * already uses. Selected values also render as read-only `Chip` pills
 * below the disclosures so an active filter stays visible without every
 * facet open.
 */
export function LandscapeFilterBar({ filters, onChange, capabilityOptions }: LandscapeFilterBarProps) {
  const active = hasActiveLandscapeFilters(filters);
  const capabilityNameById = new Map(capabilityOptions.map((c) => [c.id, c.name]));

  return (
    <div className={styles.bar} aria-label="Landscape filters">
      <FacetDisclosure
        title="Capability"
        values={filters.capabilityIds}
        options={capabilityOptions.map((c) => ({ value: c.id, label: c.name }))}
        onToggle={(value) => {
          onChange({ ...filters, capabilityIds: toggled(filters.capabilityIds, value) });
        }}
      />
      <FacetDisclosure
        title="Lifecycle"
        values={filters.lifecycleStatuses}
        options={LIFECYCLE_OPTIONS}
        onToggle={(value) => {
          onChange({ ...filters, lifecycleStatuses: toggled(filters.lifecycleStatuses, value) });
        }}
      />
      <FacetDisclosure
        title="Criticality"
        values={filters.criticalities}
        options={CRITICALITY_OPTIONS}
        onToggle={(value) => {
          onChange({ ...filters, criticalities: toggled(filters.criticalities, value) });
        }}
      />
      <FacetDisclosure
        title="Kind"
        values={filters.kinds}
        options={KIND_OPTIONS}
        onToggle={(value) => {
          onChange({ ...filters, kinds: toggled(filters.kinds, value) });
        }}
      />
      <FacetDisclosure
        title="Domain"
        values={filters.domains}
        options={DOMAIN_OPTIONS}
        onToggle={(value) => {
          onChange({ ...filters, domains: toggled(filters.domains, value) });
        }}
      />
      {active && (
        <div className={styles.activeChips}>
          {filters.capabilityIds.map((id) => (
            <Chip key={`capability-${id}`}>{capabilityNameById.get(id) ?? id}</Chip>
          ))}
          {filters.lifecycleStatuses.map((value) => (
            <Chip key={`lifecycle-${value}`}>{LIFECYCLE_OPTIONS.find((o) => o.value === value)?.label ?? value}</Chip>
          ))}
          {filters.criticalities.map((value) => (
            <Chip key={`criticality-${value}`}>{CRITICALITY_OPTIONS.find((o) => o.value === value)?.label ?? value}</Chip>
          ))}
          {filters.kinds.map((value) => (
            <Chip key={`kind-${value}`}>{SYSTEM_KIND_LABEL[value]}</Chip>
          ))}
          {filters.domains.map((value) => (
            <Chip key={`domain-${value}`}>{DOMAIN_OPTIONS.find((o) => o.value === value)?.label ?? value}</Chip>
          ))}
          <button
            type="button"
            className={styles.clearAll}
            onClick={() => {
              onChange(EMPTY_LANDSCAPE_FILTERS);
            }}
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
