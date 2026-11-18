import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '../Button/Button';
import styles from './SidePanel.module.css';

export interface SidePanelProps {
  /** The panel's name, shown as its heading and read out by screen readers. */
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A panel that slides in from the right over the page, for a form or a short
 * task that shouldn't push the page's main content down. Closes on the Close
 * button, Escape, or a click on the dimmed page behind it. Full width on a
 * narrow window.
 */
export function SidePanel({ title, onClose, children }: SidePanelProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])');
    (first ?? ref.current)?.focus();
    return () => {
      previous?.focus();
    };
  }, []);

  return (
    <div
      className={styles.scrim}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      <div
        ref={ref}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className={styles.head}>
          <h2 className={styles.title}>{title}</h2>
          <Button variant="ghost" type="button" data-close onClick={onClose} aria-label={`Close ${title}`}>
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
