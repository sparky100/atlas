import { describe, expect, it } from 'vitest';
import { captureJobStatusLabel, captureJobStatusTone } from './captureJobStatus';

describe('captureJobStatusTone / captureJobStatusLabel', () => {
  it('maps every non-pending status to a tone and label (never colour-only, branchStatus.ts\'s own sibling rule)', () => {
    expect(captureJobStatusTone({ status: 'parsed', error: null })).toBe('info');
    expect(captureJobStatusLabel({ status: 'parsed', error: null })).toBe('Parsed');

    expect(captureJobStatusTone({ status: 'reviewed', error: null })).toBe('ok');
    expect(captureJobStatusLabel({ status: 'reviewed', error: null })).toBe('Reviewed');

    expect(captureJobStatusTone({ status: 'discarded', error: null })).toBe('neutral');
    expect(captureJobStatusLabel({ status: 'discarded', error: null })).toBe('Discarded');
  });

  it('a running pending job (no error yet) reads as running, not failed', () => {
    expect(captureJobStatusTone({ status: 'pending', error: null })).toBe('info');
    expect(captureJobStatusLabel({ status: 'pending', error: null })).toBe('Running…');
  });

  it('§3.2: a pending job carrying a non-null error is a failed run awaiting retry, not a running one', () => {
    const error = { code: 'CAPTURE_RUN_FAILED', message: 'boom' };
    expect(captureJobStatusTone({ status: 'pending', error })).toBe('danger');
    expect(captureJobStatusLabel({ status: 'pending', error })).toBe('Failed');
  });
});
