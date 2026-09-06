import { Link } from 'react-router';
import { Chip } from '../Chip/Chip';
import { Text } from '../Text/Text';
import styles from './Breadcrumb.module.css';

export interface BreadcrumbSegment {
  label: string;
  href: string;
}

export interface BreadcrumbProps {
  org: BreadcrumbSegment;
  model: BreadcrumbSegment;
  /** `main`, or a tag's own name (`src/db/ref.ts`'s `refLabelOf`). */
  refLabel: string;
  /**
   * Whatever comes after `[ref]` — Capability, System, Container, Component,
   * in whichever prefix of that chain applies to the current page. "No
   * 'you could go deeper' affordance" (§2.2) — a caller passes only the
   * segments it actually has, never a placeholder for one it doesn't.
   */
  segments?: BreadcrumbSegment[];
}

/**
 * `Org › Model › [ref] › Capability › System › Container › Component`
 * (UI-principles §2.2). Always visible at top-left of any canvas or
 * element page. `[ref]` is rendered as a chip but isn't yet a button that
 * opens the ref selector — §6.2's ref selector UI doesn't exist yet (no
 * page in this product lets you pick a different tag/branch); the chip
 * still shows which state you're looking at, which is the part every page
 * that reaches this component already knows.
 */
export function Breadcrumb({ org, model, refLabel, segments = [] }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
      <Link to={org.href}>
        <Text as="span" size="sm">
          {org.label}
        </Text>
      </Link>
      <Sep />
      <Link to={model.href}>
        <Text as="span" size="sm">
          {model.label}
        </Text>
      </Link>
      <Sep />
      <Chip tone="neutral">{refLabel}</Chip>
      {segments.map((segment) => (
        <span key={segment.href} className={styles.segment}>
          <Sep />
          <Link to={segment.href}>
            <Text as="span" size="sm">
              {segment.label}
            </Text>
          </Link>
        </span>
      ))}
    </nav>
  );
}

function Sep() {
  return (
    <Text as="span" size="sm" tone="faint" className={styles.sep} aria-hidden="true">
      ›
    </Text>
  );
}
