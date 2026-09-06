import type { ReactNode } from 'react';
import styles from './Panel.module.css';

export interface PanelProps {
  raised?: boolean;
  children: ReactNode;
}

/** The one card/panel surface — element page sections, queue panes, dashboards. `raised` adds the elevation shadow (§8.4's `--surface-raised`) for a panel that floats over page content; the flat variant is for a panel that's already inside a bordered region. */
export function Panel({ raised = false, children }: PanelProps) {
  const classes = [styles.panel, raised ? styles.raised : ''].filter(Boolean).join(' ');
  return <div className={classes}>{children}</div>;
}
