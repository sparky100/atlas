import { useCallback, useMemo, useState } from 'react';

/**
 * Open/closed state for one settings page. Remembered in this browser only
 * (localStorage) — it is a view hint, not data, so it needs no table or
 * migration. Only the first section starts open until the person changes it.
 */
export interface SettingsSectionsState {
  isOpen: (id: string) => boolean;
  setOpen: (id: string, open: boolean) => void;
  setAll: (open: boolean, ids: string[]) => void;
}

function readStored(storageKey: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function useSettingsSectionsState(pageKey: string, firstSectionId: string): SettingsSectionsState {
  const storageKey = `atlas.settingsSections.${pageKey}`;
  const [stored, setStored] = useState<Record<string, boolean>>(() => readStored(storageKey));
  const persist = useCallback(
    (next: Record<string, boolean>) => {
      setStored(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Best-effort: a blocked store only means the choice isn't remembered.
      }
    },
    [storageKey],
  );
  return useMemo(
    () => ({
      isOpen: (id) => stored[id] ?? id === firstSectionId,
      setOpen: (id, open) => {
        persist({ ...stored, [id]: open });
      },
      setAll: (open, ids) => {
        persist(Object.fromEntries(ids.map((id) => [id, open])));
      },
    }),
    [stored, persist, firstSectionId],
  );
}
