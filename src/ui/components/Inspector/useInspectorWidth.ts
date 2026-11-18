import { useCallback, useEffect, useState } from 'react';
import { clampInspectorWidth, INSPECTOR_DEFAULT_WIDTH, INSPECTOR_WIDTH_STORAGE_KEY, parseStoredInspectorWidth } from './inspectorWidth';

function readStored(): number {
  try {
    return parseStoredInspectorWidth(window.localStorage.getItem(INSPECTOR_WIDTH_STORAGE_KEY));
  } catch {
    return INSPECTOR_DEFAULT_WIDTH;
  }
}

export interface UseInspectorWidthResult {
  /** The width to render now: the saved width kept inside the limits for the current window, so shrinking the window narrows the panel without losing the saved choice. */
  width: number;
  /** Save a new width (clamped) — a per-device preference, deliberately not a database column (a width depends on the screen). */
  setWidth: (value: number) => void;
  reset: () => void;
}

/**
 * The shared Inspector's own width, remembered per device in localStorage.
 * One width for every view the Inspector appears in, like the collapsed
 * state. Holds no model data, so it is outside the delta/provenance rules.
 */
export function useInspectorWidth(): UseInspectorWidthResult {
  const [saved, setSaved] = useState<number>(readStored);
  const [viewport, setViewport] = useState<number>(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => {
      setViewport(window.innerWidth);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const persist = useCallback((value: number | null) => {
    try {
      if (value === null) window.localStorage.removeItem(INSPECTOR_WIDTH_STORAGE_KEY);
      else window.localStorage.setItem(INSPECTOR_WIDTH_STORAGE_KEY, String(value));
    } catch {
      // Storage unavailable (private mode, quota): the width still works for this visit.
    }
  }, []);

  const setWidth = useCallback(
    (value: number) => {
      const next = clampInspectorWidth(value, window.innerWidth);
      setSaved(next);
      persist(next);
    },
    [persist],
  );

  const reset = useCallback(() => {
    setSaved(INSPECTOR_DEFAULT_WIDTH);
    persist(null);
  }, [persist]);

  return { width: clampInspectorWidth(saved, viewport), setWidth, reset };
}
