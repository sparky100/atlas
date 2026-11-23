/* eslint-disable react-refresh/only-export-components -- one small context and its two hooks. */
import { createContext, useContext, useEffect, useMemo, useRef, type MouseEvent, type ReactNode } from 'react';

interface UnsavedChangesState {
  setDirty: (dirty: boolean) => void;
  isDirty: () => boolean;
}

const UnsavedChangesContext = createContext<UnsavedChangesState | null>(null);

/**
 * One platform-admin editor at a time can be dirty. The nav asks the context
 * at click time, so a route change never needs a re-render just to check it.
 * `beforeunload` covers a tab close; browser Back is a known gap because the
 * app uses `BrowserRouter`, which has no navigation blocker.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(false);
  const value = useMemo<UnsavedChangesState>(() => ({
    setDirty: (next) => { dirty.current = next; },
    isDirty: () => dirty.current,
  }), []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => { window.removeEventListener('beforeunload', onBeforeUnload); };
  }, []);

  return <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>;
}

/** An editor registers its dirty state here for as long as it is mounted. */
export function useUnsavedChanges(dirty: boolean): void {
  const state = useContext(UnsavedChangesContext);
  useEffect(() => {
    if (state === null) return undefined;
    state.setDirty(dirty);
    return () => { state.setDirty(false); };
  }, [state, dirty]);
}

/** The guard the platform-admin nav puts on every outbound link. */
export function useUnsavedChangesGuard(): (event: MouseEvent) => void {
  const state = useContext(UnsavedChangesContext);
  return (event) => {
    if (!state?.isDirty()) return;
    if (!window.confirm('You have unsaved changes. Leave without saving?')) event.preventDefault();
  };
}
