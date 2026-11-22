import { useCallback, useEffect, useState } from 'react';
import type { SampleModelAdminSummary } from '../../contracts/sampleModelAdmin';
import { SAMPLE_WITHDRAWAL_REASON_MAX } from '../../contracts/sampleModelAdmin';
import { listSampleModelsForAdmin, reinstateSampleModel, withdrawSampleModel } from '../../db/sampleModelAdmin';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Loading } from '../components/Loading/Loading';
import { SettingsSection } from '../components/SettingsSection/SettingsSection';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import styles from './SampleModelAdmin.module.css';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function formatDate(value: string | null): string {
  return value === null ? '' : dateFormat.format(new Date(value));
}

/**
 * Platform admin: published sample models and their current sharing state.
 * Withdrawal is sample-level and append-only: it hides the slug from ordinary
 * users but never edits or deletes a published version. Existing copies in
 * organisations are their own models and are not recalled.
 */
export function SampleModelAdmin() {
  const [samples, setSamples] = useState<SampleModelAdminSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setSamples(await listSampleModelsForAdmin(supabase));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh sets state only after its awaited reads.
    void refresh()
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { setLoading(false); });
  }, [refresh]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const withdraw = (sample: SampleModelAdminSummary) => void run(async () => {
    const reason = (reasons[sample.slug] ?? '').trim();
    if (reason === '') throw new Error('Give a reason for withdrawing this sample.');
    await withdrawSampleModel(supabase, sample.slug, reason);
    setReasons((current) => ({ ...current, [sample.slug]: '' }));
    await refresh();
    setNotice(`Withdrew ${sample.name}. Existing copies are unchanged.`);
  });

  const reinstate = (sample: SampleModelAdminSummary) => void run(async () => {
    await reinstateSampleModel(supabase, sample.slug, null);
    await refresh();
    setNotice(`Shared ${sample.name} again. It is available to new organisations.`);
  });

  const shared = samples.filter((sample) => sample.shared).length;
  const withdrawn = samples.length - shared;

  return (
    <SettingsSection id="sample-models" title="Sample models" summary={`${String(shared)} shared · ${String(withdrawn)} withdrawn`}>
      <Text as="p" tone="muted" size="sm">
        Published sample models that new organisations can start from. Withdrawing hides every version of a sample from ordinary users, but keeps the published rows for audit. Copies already made by organisations are their own models and are not recalled.
      </Text>
      {error !== '' && <div role="alert"><Text as="p" className={styles.error}>{error}</Text></div>}
      {notice !== '' && <div role="status"><Text as="p">{notice}</Text></div>}
      {loading && <Loading />}
      {!loading && samples.length === 0 && <Text as="p" tone="muted">No sample models have been published.</Text>}
      {!loading && samples.length > 0 && <ul className={styles.list} aria-label="Published sample models">
        {samples.map((sample) => <li className={styles.card} key={sample.slug}>
          <div className={styles.head}>
            <div>
              <Text as="h3" size="md">{sample.name}</Text>
              <Text as="p" size="sm" tone="muted">{sample.slug} · latest version {sample.latestVersion} · published {formatDate(sample.publishedAt)}</Text>
            </div>
            <Chip tone={sample.shared ? 'ok' : 'warn'}>{sample.shared ? 'Shared' : 'Withdrawn'}</Chip>
          </div>
          {sample.description !== null && sample.description.trim() !== '' && <Text as="p" size="sm">{sample.description}</Text>}
          {!sample.shared && (
            <div className={styles.state}>
              <Text as="p" size="sm">Withdrawn {formatDate(sample.withdrawnAt)}{sample.withdrawnReason !== null ? `: ${sample.withdrawnReason}` : '.'}</Text>
              <Button type="button" variant="secondary" onClick={() => { reinstate(sample); }} disabled={busy}>
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
                  value={reasons[sample.slug] ?? ''}
                  onChange={(event) => { setReasons((current) => ({ ...current, [sample.slug]: event.target.value })); }}
                  placeholder="Why should new organisations no longer be offered this sample?"
                />
              </label>
              <Button type="button" variant="secondary" onClick={() => { withdraw(sample); }} disabled={busy || (reasons[sample.slug] ?? '').trim() === ''}>
                Withdraw
              </Button>
            </details>
          )}
        </li>)}
      </ul>}
    </SettingsSection>
  );
}
