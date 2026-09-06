import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { OrganisationRow } from '../../../db/types';
import styles from './OrgSwitcher.module.css';

export interface OrgSwitcherProps {
  organisations: OrganisationRow[];
  currentOrgSlug: string;
}

/**
 * The breadcrumb's `Org` segment made interactive (UI-principles §2.2) —
 * a plain select for now (no design-system dropdown primitive exists yet);
 * navigates to the same-shaped route under the chosen org.
 */
export function OrgSwitcher({ organisations, currentOrgSlug }: OrgSwitcherProps) {
  const navigate = useNavigate();
  const [value, setValue] = useState(currentOrgSlug);

  return (
    <select
      className={styles.select}
      aria-label="Switch organisation"
      value={value}
      onChange={(e) => {
        const slug = e.target.value;
        setValue(slug);
        void navigate(`/o/${slug}`);
      }}
    >
      {organisations.map((org) => (
        <option key={org.id} value={org.slug}>
          {org.name}
        </option>
      ))}
    </select>
  );
}
