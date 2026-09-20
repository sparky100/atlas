import type { CaptureJob } from '../../contracts/capture';
import type { ChipTone } from '../components/Chip/Chip';

type JobStatusFields = Pick<CaptureJob, 'status' | 'error'>;

/**
 * Status (+ a live error) → chip tone/label — never colour-only (Chip's own
 * convention, `changes/branchStatus.ts`'s sibling). A `pending` job
 * carrying a non-null `error` is a failed run awaiting retry
 * (SPEC-capture.md §3.2: "a failed job stays `pending` with `error`
 * non-null"), not a running one — there is no separate `failed` status
 * value on `CaptureStatus` to switch on instead.
 */
export function captureJobStatusTone(job: JobStatusFields): ChipTone {
  if (job.status === 'pending' && job.error !== null) return 'danger';
  switch (job.status) {
    case 'pending':
      return 'info';
    case 'parsed':
      return 'info';
    case 'reviewed':
      return 'ok';
    case 'discarded':
      return 'neutral';
  }
}

export function captureJobStatusLabel(job: JobStatusFields): string {
  if (job.status === 'pending' && job.error !== null) return 'Failed';
  switch (job.status) {
    case 'pending':
      return 'Running…';
    case 'parsed':
      return 'Parsed';
    case 'reviewed':
      return 'Reviewed';
    case 'discarded':
      return 'Discarded';
  }
}
