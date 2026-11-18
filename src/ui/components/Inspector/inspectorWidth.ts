/** Default, minimum and maximum Inspector width in px — the range the drag handle and keyboard keep the panel within. */
export const INSPECTOR_DEFAULT_WIDTH = 300;
export const INSPECTOR_MIN_WIDTH = 260;
export const INSPECTOR_MAX_WIDTH = 640;
/** Keyboard step in px; Shift uses the larger one. */
export const INSPECTOR_KEY_STEP = 16;
export const INSPECTOR_KEY_STEP_LARGE = 64;
export const INSPECTOR_WIDTH_STORAGE_KEY = 'atlas.inspectorWidth';

/** The widest the panel may be right now: the fixed ceiling, but never more than half the window, so the map or canvas always keeps at least half. */
export function inspectorMaxFor(viewportWidth: number): number {
  return Math.max(INSPECTOR_MIN_WIDTH, Math.min(INSPECTOR_MAX_WIDTH, Math.floor(viewportWidth / 2)));
}

export function clampInspectorWidth(width: number, viewportWidth: number): number {
  if (!Number.isFinite(width)) return INSPECTOR_DEFAULT_WIDTH;
  return Math.round(Math.min(inspectorMaxFor(viewportWidth), Math.max(INSPECTOR_MIN_WIDTH, width)));
}

/** Parses a stored value; anything that isn't a plain finite number falls back to the default (a hand-edited or corrupt entry never breaks the layout). */
export function parseStoredInspectorWidth(raw: string | null): number {
  if (raw === null || raw.trim() === '') return INSPECTOR_DEFAULT_WIDTH;
  const n = Number(raw);
  return Number.isFinite(n) ? n : INSPECTOR_DEFAULT_WIDTH;
}
