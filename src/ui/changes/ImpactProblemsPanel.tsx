/**
 * "Problems this change causes": capabilities it leaves with no system, and
 * provider-side dependencies that are ending or being removed. Shows
 * nothing at all when there is nothing wrong (project UX rule: never a
 * reassurance row), and every named element is a link to its own page.
 */
import { Link } from 'react-router';
import type { ImpactProblems, NamedElement } from '../../engine/changeImpactProblems';
import { Chip } from '../components/Chip/Chip';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { hasImpactProblems } from './hasImpactProblems';
import styles from './ChangeView.module.css';

export function ImpactProblemsPanel({ problems, orgSlug, modelSlug }: { problems: ImpactProblems; orgSlug: string; modelSlug: string }) {
  if (!hasImpactProblems(problems)) return null;
  const link = (el: NamedElement) => (
    <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${el.id}`}>
      <Text as="span">{el.name}</Text>
    </Link>
  );
  const names = (els: readonly NamedElement[]) =>
    els.map((el, i) => (
      <span key={el.id}>
        {i > 0 && ', '}
        {link(el)}
      </span>
    ));

  return (
    <Panel>
      <Text as="h2" size="lg">
        Problems this change causes
      </Text>
      <ul className={styles.capabilityList}>
        {problems.capabilitiesLeftWithoutSystem.map((c) => (
          <li key={`cap-${c.id}`}>
            <div className={styles.subjectTitle}>
              <Chip tone="warn">No system</Chip>
              {link(c)}
            </div>
            <Text as="p" tone="muted" size="sm">
              {c.formerSystems.length > 0 ? <>No system supports it after this change. It was supported by {names(c.formerSystems)}.</> : 'No system supports it after this change.'}
            </Text>
          </li>
        ))}
        {problems.providerProblems.map((p) => (
          <li key={`${p.kind}-${p.consumer.id}-${p.provider.id}`}>
            <div className={styles.subjectTitle}>
              <Chip tone="warn">{p.kind === 'provider_ending' ? 'End of life' : 'Removed'}</Chip>
              {link(p.consumer)}
            </div>
            <Text as="p" tone="muted" size="sm">
              {p.kind === 'provider_ending' ? <>Depends on {link(p.provider)}, which ends on {p.plannedEnd} and has no replacement.</> : <>Still depends on {link(p.provider)}, which this change removes.</>}
            </Text>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
