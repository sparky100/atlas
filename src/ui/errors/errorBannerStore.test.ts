import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissError, getErrorSnapshot, reportError, resetErrorBannerStoreForTests, subscribeErrors } from './errorBannerStore';

afterEach(() => {
  resetErrorBannerStoreForTests();
});

describe('reportError / getErrorSnapshot', () => {
  it('starts empty', () => {
    expect(getErrorSnapshot()).toEqual([]);
  });

  it('adds a message, returning an id', () => {
    const id = reportError('Could not load this model.');
    expect(getErrorSnapshot()).toEqual([{ id, text: 'Could not load this model.' }]);
  });

  it('de-duplicates identical text rather than stacking it — the same failed fetch re-firing (React StrictMode\'s dev-only double-invoke among them) shows one banner, not two', () => {
    const firstId = reportError('Could not load this model.');
    const secondId = reportError('Could not load this model.');
    expect(secondId).toBe(firstId);
    expect(getErrorSnapshot()).toHaveLength(1);
  });

  it('keeps distinct messages as separate rows', () => {
    reportError('Could not load this model.');
    reportError('Could not load the branch to edit.');
    expect(getErrorSnapshot()).toHaveLength(2);
  });
});

describe('reportError detail (S1 item 9: "one plain sentence; detail to console")', () => {
  it('never puts detail into the banner text, even when given', () => {
    const id = reportError('Could not load this model.', new Error('relation "elements_head" does not exist'));
    expect(getErrorSnapshot()).toEqual([{ id, text: 'Could not load this model.' }]);
  });

  it('logs detail to the console when given', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const detail = new Error('boom');
    reportError('Could not load this model.', detail);
    expect(spy).toHaveBeenCalledWith('Could not load this model.', detail);
    spy.mockRestore();
  });

  it('never logs to the console when no detail is given', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    reportError('Could not load this model.');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('dismissError', () => {
  it('removes exactly the dismissed message', () => {
    const keepId = reportError('Could not load this model.');
    const dismissId = reportError('Could not load the branch to edit.');
    dismissError(dismissId);
    expect(getErrorSnapshot()).toEqual([{ id: keepId, text: 'Could not load this model.' }]);
  });

  it('is a no-op for an unknown id', () => {
    reportError('Could not load this model.');
    const before = getErrorSnapshot();
    dismissError('11111111-1111-1111-1111-111111111111');
    expect(getErrorSnapshot()).toEqual(before);
  });
});

describe('subscribeErrors', () => {
  it('notifies subscribers on report and dismiss, and stops after unsubscribing', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeErrors(listener);

    const id = reportError('Could not load this model.');
    expect(listener).toHaveBeenCalledTimes(1);

    dismissError(id);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    reportError('Could not load the branch to edit.');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
