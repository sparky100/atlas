/**
 * F2 (full K1) PR14: the capture job list — "start a capture run" plus
 * every capture job on this model, its live status, and the failed-job
 * Retry action. Mirrors `src/ui/changes/ChangesView.tsx`'s shape (a create
 * action gated by role, loading/empty states, a list of rows with a status
 * chip) for the same reasons that file's own comment gives.
 *
 * PR15 built the review queue — a `parsed` job links to it directly.
 */
import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { CaptureJob, CaptureJobProgress } from '../../contracts/capture';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { LinkButton } from '../components/Button/LinkButton';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { captureJobStatusLabel, captureJobStatusTone } from './captureJobStatus';
import { useCaptureJobs } from './useCaptureJob';
import { UploadCaptureDialog } from './UploadCaptureDialog';
import styles from './CaptureJobListView.module.css';

export interface CaptureJobListViewProps {
  modelId: UUID;
  orgId: UUID;
  orgSlug: string;
  modelSlug: string;
  /** Contributor+ (`capture_jobs_insert`'s RLS) — omitted entirely, not shown disabled, matching every other role-gated action in this codebase. */
  canCreate: boolean;
}

const PROGRESS_STAGE_LABEL: Record<CaptureJobProgress['stage'], string> = {
  parse: 'Parsing',
  extract: 'Extracting',
  match: 'Matching',
  write: 'Writing',
};

/** How many runs to show before collapsing behind "View more". */
const PAGE_SIZE = 8;

export function CaptureJobListView({ modelId, orgId, orgSlug, modelSlug, canCreate }: CaptureJobListViewProps) {
  const { userId } = useAuth();
  const { status, jobs, error, createJob, retryJob, discardJob } = useCaptureJobs(modelId, orgId, userId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visibleJobs = jobs.slice(0, visibleCount);

  return (
    <div>
      <div className={styles.header}>
        <Text as="h2" size="lg">
          Capture runs
        </Text>
        {canCreate && (
          <Button
            variant="primary"
            onClick={() => {
              setUploadOpen(true);
            }}
          >
            New capture run
          </Button>
        )}
      </div>

      {!canCreate && (
        <Panel>
          <Text as="p" size="sm">
            A capture run reads a spreadsheet, PDF, or pasted text with AI extraction, matches what it finds against this model, and produces a draft a reviewer accepts or rejects candidate by candidate — nothing changes on main until then.
          </Text>
        </Panel>
      )}

      {status === 'loading' && jobs.length === 0 && <Text tone="muted">Loading…</Text>}
      {error !== null && (
        <Text as="p" size="sm">
          {error}
        </Text>
      )}
      {jobs.length === 0 && status !== 'loading' && <EmptyState>No capture runs yet. {canCreate ? 'Start one above.' : 'Nobody has started one.'}</EmptyState>}

      <ul className={styles.list}>
        {visibleJobs.map((job) => (
          <CaptureJobRow key={job.id} job={job} orgSlug={orgSlug} modelSlug={modelSlug} onRetry={() => { retryJob(job.id); }} onDiscard={() => { discardJob(job.id); }} />
        ))}
      </ul>
      {jobs.length > visibleCount && (
        <Button variant="ghost" onClick={() => { setVisibleCount((c) => c + PAGE_SIZE); }}>
          View more ({jobs.length - visibleCount} more)
        </Button>
      )}

      {canCreate && (
        <UploadCaptureDialog
          open={uploadOpen}
          onClose={() => {
            setUploadOpen(false);
          }}
          modelId={modelId}
          createJob={createJob}
          status={status}
          error={error}
        />
      )}
    </div>
  );
}

function CaptureJobRow({ job, orgSlug, modelSlug, onRetry, onDiscard }: { job: CaptureJob; orgSlug: string; modelSlug: string; onRetry: () => void; onDiscard: () => void }) {
  const isRunning = job.status === 'pending' && job.error === null;
  const isFailed = job.status === 'pending' && job.error !== null;
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <Text as="span" size="lg">
          {job.inputName}
        </Text>
        <div className={styles.rowMeta}>
          <Chip tone={captureJobStatusTone(job)}>{captureJobStatusLabel(job)}</Chip>
          <Chip tone="neutral">{job.inputKind}</Chip>
          {job.reimportOfJobId !== null && <Chip tone="neutral">Re-import</Chip>}
          <Text as="span" tone="faint" size="xs">
            {job.createdAt.slice(0, 10)}
          </Text>
        </div>
        {isRunning && job.progress && (
          <Text as="p" tone="muted" size="sm">
            {PROGRESS_STAGE_LABEL[job.progress.stage]}…
          </Text>
        )}
        {isFailed && job.error && (
          <Text as="p" size="sm">
            {job.error.message}
          </Text>
        )}
      </div>
      {isFailed && (
        <div className={styles.rowActions}>
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
          <Button variant="ghost" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      )}
      {isRunning && (
        <div className={styles.rowActions}>
          <Button variant="ghost" onClick={onDiscard}>
            Cancel
          </Button>
        </div>
      )}
      {job.status === 'parsed' && (
        <div className={styles.rowActions}>
          <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/review/capture/${job.id}`} variant="secondary">
            Review →
          </LinkButton>
        </div>
      )}
    </li>
  );
}
