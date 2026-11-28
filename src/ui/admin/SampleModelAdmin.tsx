import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { SampleModelAdminSummary } from '../../contracts/sampleModelAdmin';
import { SAMPLE_WITHDRAWAL_REASON_MAX } from '../../contracts/sampleModelAdmin';
import { listSampleModelsForAdmin, reinstateSampleModel, withdrawSampleModel } from '../../db/sampleModelAdmin';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Loading } from '../components/Loading/Loading';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import styles from './SampleModelAdmin.module.css';
import { errorText } from './adminErrorText';

const BASE = '/platform-admin/sample-models';
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function formatDate(value: string | null): string {
  return value === null ? '' : dateFormat.format(new Date(value));
}

/**
 * `/platform-admin/sample-models/:slug` — one published sample model and its
 * sharing state. Withdrawal is sample-level and append-only: it hides the
 * slug from ordinary users but never edits or deletes a published version.
 * Existing copies in organisations are their own models and are not recalled.
 */
export function SampleModelAdmin({ slug }: { slug: string }) {
  const [sample, setSample] = useState<SampleModelAdminSummary | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const samples = await listSampleModelsForAdmin(supabase);
    setSample(samples.find((candidate) => candidate.slug === slug) ?? null);
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh sets state only after its awaited reads.
    void refresh()
      .catch((cause: unknown) => { setLoadError(errorText(cause)); })
      .finally(() => { setLoading(false); });
  }, [refresh]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };

  const withdraw = () => void run(async () => {
    if (sample === null) return;
    const trimmed = reason.trim();
    if (trimmed === '') throw new Error('Give a reason for withdrawing this sample.');
    await withdrawSampleModel(supabase, sample.slug, trimmed);
    await refresh();
    setReason('');
    setNotice(`Withdrew ${sample.name}. Existing copies are unchanged.`);
  });

  const reinstate = () => void run(async () => {
    if (sample === null) return;
    await reinstateSampleModel(supabase, sample.slug, null);
    await refresh();
    setNotice(`Shared ${sample.name} again. It is available to new organisations.`);
  });

  if (loading) return <Loading />;
  if (loadError !== '' || sample === null) {
    return (
      <div className={styles.page}>
        <Link to={BASE} className={styles.backLink}>← Sample models</Link>
        <p role="alert" className={styles.error}>{loadError !== '' ? loadError : 'This sample model could not be found.'}</p>
      </div>
    );
  }

  return (
    <div className={styles.page} data-testid="sample-model-admin">
      <Link to={BASE} className={styles.backLink}>← Sample models</Link>
      <div className={styles.head}>
        <div>
          <Text as="h1" size="2xl">{sample.name}</Text>
          <Text as="p" size="sm" tone="muted">
            {sample.slug} · latest version {sample.latestVersion} · published {formatDate(sample.publishedAt)}
          </Text>
        </div>
        <Chip tone={sample.shared ? 'ok' : 'warn'}>{sample.shared ? 'Shared' : 'Withdrawn'}</Chip>
      </div>

      {sample.description !== null && sample.description.trim() !== '' && <Text as="p" size="sm">{sample.description}</Text>}
      {error !== '' && <div role="alert"><Text as="p" className={styles.error}>{error}</Text></div>}
      {notice !== '' && <div role="status"><Text as="p">{notice}</Text></div>}

      {!sample.shared && (
        <div className={styles.state}>
          <Text as="p" size="sm">
            Withdrawn {formatDate(sample.withdrawnAt)}{sample.withdrawnReason !== null ? `: ${sample.withdrawnReason}` : '.'}
          </Text>
          <Button type="button" variant="secondary" onClick={reinstate} disabled={busy}>
            Share again
          </Button>
        </div>
      )}

      {sample.shared && sample.reinstatedAt !== null && (
        <Text as="p" size="sm" tone="muted">Shared again {formatDate(sample.reinstatedAt)}.</Text>
      )}

      {sample.shared && (
        <details className={styles.withdraw}>
          <summary>Withdraw this sample</summary>
          <label>
            Reason
            <input
              type="text"
              maxLength={SAMPLE_WITHDRAWAL_REASON_MAX}
              value={reason}
              onChange={(event) => { setReason(event.target.value); }}
              placeholder="Why should new organisations no longer be offered this sample?"
            />
          </label>
          <Button type="button" variant="secondary" onClick={withdraw} disabled={busy || reason.trim() === ''}>
            Withdraw
          </Button>
        </details>
      )}
    </div>
  );
}
