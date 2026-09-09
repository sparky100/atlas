import type { ReactNode } from 'react';
import styles from './Panel.module.css';

export interface PanelProps {
  raised?: boolean;
  /** Appended after the panel's own classes — for a caller that needs panel chrome plus its own layout (e.g. ElementPage.module.css's `.toast`), never to override the panel surface itself. */
  className?: string;
  /** A stable hook for tests only — never read by application code. */
  'data-testid'?: string;
  children: ReactNode;
}

/** The one card/panel surface — element page sections, queue panes, dashboards. `raised` adds the elevation shadow (§8.4's `--surface-raised`) for a panel that floats over page content; the flat variant is for a panel that's already inside a bordered region. */
export function Panel({ raised = false, className, 'data-testid': testId, children }: PanelProps) {
  const classes = [styles.panel, raised ? styles.raised : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={classes} data-testid={testId}>
      {children}
    </div>
  );
}
