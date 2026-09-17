import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissToast, getToastSnapshot, reportToast, resetToastStoreForTests, subscribeToasts } from './toastStore';

afterEach(() => {
  resetToastStoreForTests();
  vi.useRealTimers();
});

describe('reportToast / getToastSnapshot', () => {
  it('starts empty', () => {
    expect(getToastSnapshot()).toEqual([]);
  });

  it('adds a message, returning an id', () => {
    const id = reportToast('Saved to change: Retire the legacy CRM');
    expect(getToastSnapshot()).toEqual([{ id, text: 'Saved to change: Retire the legacy CRM' }]);
  });

  it('does not de-duplicate identical text — unlike errorBannerStore, a second identical save is a second real event', () => {
    const firstId = reportToast('Saved to change: Retire the legacy CRM');
    const secondId = reportToast('Saved to change: Retire the legacy CRM');
    expect(secondId).not.toBe(firstId);
    expect(getToastSnapshot()).toHaveLength(2);
  });
});

describe('reportToast with an action', () => {
  it('carries the action through to the snapshot', () => {
    const onClick = vi.fn();
    const id = reportToast('Merged "Loser" into "Survivor"', { label: 'Undo', onClick });
    expect(getToastSnapshot()).toEqual([{ id, text: 'Merged "Loser" into "Survivor"', action: { label: 'Undo', onClick } }]);
  });

  it('has no action field at all for a plain reportToast call — every existing caller is unaffected', () => {
    reportToast('Saved to change: A');
    expect(getToastSnapshot()[0]?.action).toBeUndefined();
  });
});

describe('dismissToast', () => {
  it('removes exactly the dismissed message', () => {
    const keepId = reportToast('Saved to change: A');
    const dismissId = reportToast('Saved to change: B');
    dismissToast(dismissId);
    expect(getToastSnapshot()).toEqual([{ id: keepId, text: 'Saved to change: A' }]);
  });

  it('is a no-op for an unknown id', () => {
    reportToast('Saved to change: A');
    const before = getToastSnapshot();
    dismissToast('11111111-1111-1111-1111-111111111111');
    expect(getToastSnapshot()).toEqual(before);
  });
});

describe('auto-dismiss', () => {
  it('dismisses itself after ~4s with no explicit dismissToast call', () => {
    vi.useFakeTimers();
    reportToast('Saved to change: A');
    expect(getToastSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(getToastSnapshot()).toHaveLength(0);
  });

  it('an explicit dismissToast before the timer fires does not double-remove or error', () => {
    vi.useFakeTimers();
    const id = reportToast('Saved to change: A');
    dismissToast(id);
    expect(() => {
      vi.advanceTimersByTime(4000);
    }).not.toThrow();
    expect(getToastSnapshot()).toHaveLength(0);
  });
});

describe('subscribeToasts', () => {
  it('notifies subscribers on report and dismiss, and stops after unsubscribing', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToasts(listener);

    const id = reportToast('Saved to change: A');
    expect(listener).toHaveBeenCalledTimes(1);

    dismissToast(id);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    reportToast('Saved to change: B');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
