import { describe, expect, it } from 'vitest';
import { clampInspectorWidth, inspectorMaxFor, parseStoredInspectorWidth } from './inspectorWidth';

describe('inspector width', () => {
  it('clamps to the minimum and the fixed maximum', () => {
    expect(clampInspectorWidth(100, 1920)).toBe(260);
    expect(clampInspectorWidth(900, 1920)).toBe(640);
    expect(clampInspectorWidth(400, 1920)).toBe(400);
  });
  it('never exceeds half the window', () => {
    expect(inspectorMaxFor(1000)).toBe(500);
    expect(clampInspectorWidth(640, 1000)).toBe(500);
  });
  it('never drops below the minimum even in a very narrow window', () => {
    expect(inspectorMaxFor(400)).toBe(260);
  });
  it('falls back to 300 for missing or corrupt stored values', () => {
    expect(parseStoredInspectorWidth(null)).toBe(300);
    expect(parseStoredInspectorWidth('')).toBe(300);
    expect(parseStoredInspectorWidth('abc')).toBe(300);
    expect(parseStoredInspectorWidth('420')).toBe(420);
    expect(clampInspectorWidth(Number.NaN, 1280)).toBe(300);
  });
});
