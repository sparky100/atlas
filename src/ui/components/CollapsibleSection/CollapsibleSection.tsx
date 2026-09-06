import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import styles from './CollapsibleSection.module.css';

export interface CollapsibleSectionProps {
  title: ReactNode;
  /** A count or short status shown after the title (e.g. "(3)", "2 unresolved"). */
  meta?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Controlled mode — pass both to let a parent remember state per user (element page §4.1: "state remembered per user"); this component only owns open/closed mechanics, not where that memory lives. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Every element-page section (§4.1) is one of these: a disclosure button
 * (keyboard- and screen-reader-operable per §8.7) plus a content region.
 * No tabs anywhere in the product — this is the section-collapse mechanism
 * that stands in for tabs.
 */
export function CollapsibleSection({ title, meta, children, defaultOpen = true, open, onOpenChange }: CollapsibleSectionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = open ?? uncontrolledOpen;
  const contentId = useId();

  function toggle() {
    const next = !isOpen;
    if (onOpenChange) onOpenChange(next);
    else setUncontrolledOpen(next);
  }

  return (
    <section className={styles.section}>
      <button type="button" className={styles.header} aria-expanded={isOpen} aria-controls={contentId} onClick={toggle}>
        <span className={styles.disclosure} aria-hidden="true">
          {isOpen ? '▾' : '▸'}
        </span>
        <span className={styles.title}>{title}</span>
        {meta !== undefined && <span className={styles.meta}>{meta}</span>}
      </button>
      {isOpen && (
        <div id={contentId} className={styles.content}>
          {children}
        </div>
      )}
    </section>
  );
}
