import { createContext, useContext, useId, useState } from 'react';
import type { ReactNode } from 'react';
import styles from './SettingsSection.module.css';
import type { SettingsSectionsState } from './useSettingsSectionsState';

const SettingsSectionsContext = createContext<SettingsSectionsState | null>(null);

export interface SettingsSectionsProps {
  state: SettingsSectionsState;
  /** Every section id on the page, for Expand all / Collapse all. */
  ids: string[];
  children: ReactNode;
}

/** The list of sections plus the Expand all / Collapse all controls. */
export function SettingsSections({ state, ids, children }: SettingsSectionsProps) {
  return (
    <SettingsSectionsContext.Provider value={state}>
      <div className={styles.tools}>
        <button type="button" className={styles.toolButton} onClick={() => { state.setAll(true, ids); }}>
          Expand all
        </button>
        <button type="button" className={styles.toolButton} onClick={() => { state.setAll(false, ids); }}>
          Collapse all
        </button>
      </div>
      <div className={styles.list}>{children}</div>
    </SettingsSectionsContext.Provider>
  );
}

export interface SettingsSectionProps {
  id: string;
  title: string;
  /** One line shown when closed (and beside the title when wide): the current value. */
  summary?: ReactNode;
  /** Destructive sections only — the single place red is used on these pages. */
  danger?: boolean;
  children: ReactNode;
}

/**
 * One collapsible card on a settings page. The content stays mounted while
 * closed (hidden), so a half-typed form or a loaded list survives a collapse.
 */
export function SettingsSection({ id, title, summary, danger = false, children }: SettingsSectionProps) {
  const state = useContext(SettingsSectionsContext);
  const contentId = useId();
  const [fallbackOpen, setFallbackOpen] = useState(true);
  const open = state ? state.isOpen(id) : fallbackOpen;
  const toggle = () => {
    if (state) state.setOpen(id, !open);
    else setFallbackOpen(!open);
  };
  return (
    <section className={`${styles.card ?? ''} ${danger ? (styles.danger ?? '') : ''}`} data-testid={`settings-section-${id}`}>
      <h2 className={styles.heading}>
        <button type="button" className={styles.header} aria-expanded={open} aria-controls={contentId} onClick={toggle}>
          <span className={styles.disclosure} aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className={styles.title}>{title}</span>
          {summary !== undefined && summary !== null && <span className={styles.summary}>{summary}</span>}
        </button>
      </h2>
      <div id={contentId} className={styles.content} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
