import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { SampleModelAdminSummary } from '../../contracts/sampleModelAdmin';
import { listSampleModelsForAdmin } from '../../db/sampleModelAdmin';
import { Chip } from '../components/Chip/Chip';
import { Loading } from '../components/Loading/Loading';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import styles from './SampleModelAdmin.module.css';
import { errorText } from './adminErrorText';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** `/platform-admin/sample-models` — published samples and their sharing state, one row per slug. */
export function SampleModelsAdmin() {
  const [samples, setSamples] = useState<SampleModelAdminSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void listSampleModelsForAdmin(supabase)
      .then(setSamples)
      .catch((cause: unknown) => { setError(errorText(cause)); })
      .finally(() => { setLoading(false); });
  }, []);

  if (loading) return <Loading />;

  const shared = samples.filter((sample) => sample.shared).length;
  const withdrawn = samples.length - shared;

  return (
    <div className={styles.page} data-testid="sample-models-admin">
      {error !== '' && <div role="alert"><Text as="p" className={styles.error}>{error}</Text></div>}
      <Text as="p" tone="muted" size="sm">
        {shared} shared · {withdrawn} withdrawn. Withdrawing hides every version of a sample from ordinary users but keeps the published rows for audit.
      </Text>
      {samples.length === 0 && <Text as="p" tone="muted">No sample models have been published.</Text>}
      {samples.length > 0 && (
        <ul className={styles.list} aria-label="Published sample models">
          {samples.map((sample) => (
            <li className={styles.card} key={sample.slug}>
              <div className={styles.head}>
                <div>
                  <Text as="h2" size="md">
                    <Link to={`/platform-admin/sample-models/${sample.slug}`}>{sample.name}</Link>
                  </Text>
                  <Text as="p" size="sm" tone="muted">
                    {sample.slug} · latest version {sample.latestVersion} · published {dateFormat.format(new Date(sample.publishedAt))}
                  </Text>
                </div>
                <Chip tone={sample.shared ? 'ok' : 'warn'}>{sample.shared ? 'Shared' : 'Withdrawn'}</Chip>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
