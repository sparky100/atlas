import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { findAndSaveComponents, type ComponentSearchOutcome } from '../../db/catalogueAdmin';
import { supabase } from '../supabaseClient';
import styles from './CatalogueAdmin.module.css';
import { errorText } from './adminErrorText';

const BASE = '/platform-admin/catalogue';

type Outcome = ComponentSearchOutcome;

/**
 * "Find components" on a saved product that is not itself a component. One
 * targeted web search for the vendor's own list of the platform's modules. Each
 * module whose cited page quotes a sentence and names the platform is saved as a
 * draft component of this product, found by the Researcher, with no capability
 * links yet. Modules already in the library are shown and left as they are.
 * Nothing is published. Only the platform's name and vendor are sent.
 */
export function CatalogueFindComponents({ platform, knownComponents = [], disabled, onChanged, autoRun = false }: { platform: { id: string; product: string; vendor: string }; knownComponents?: string[]; disabled: boolean; onChanged: () => void; autoRun?: boolean }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const run = async () => {
    setRunning(true); setError(''); setOutcome(null);
    try {
      setOutcome(await findAndSaveComponents(supabase, platform, knownComponents, new Date().toISOString().slice(0, 10)));
      onChanged();
    } catch (cause) {
      setError(`${errorText(cause)} Nothing was added.`);
    } finally {
      setRunning(false);
    }
  };

  // "Add a platform" lands here and starts the search once, so one action does both.
  const started = useRef(false);
  useEffect(() => {
    if (autoRun && !disabled && !started.current) { started.current = true; void run(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once, when the page first allows it
  }, [autoRun, disabled]);

  return (
    <div data-testid="find-components">
      <p>
        The Researcher can search the public web for the modules of {platform.product}. A repeat search skips the components it already has. Only modules whose source page names {platform.product} are kept. Each is added as a draft component with no capability links yet, for a person to review. Nothing is published.
      </p>
      <button type="button" onClick={() => void run()} disabled={running || disabled}>
        {running ? 'Searching…' : knownComponents.length > 0 ? `Search again for more components of ${platform.product}` : `Find components of ${platform.product}`}
      </button>
      {disabled && <p role="status">Save this product first.</p>}
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {outcome !== null && (
        <div role="status" data-testid="find-components-outcome">
          {outcome.found === 0 && outcome.dropped === 0
            ? <p>No components found for {platform.product}.{outcome.note === null ? '' : ` ${outcome.note}`}</p>
            : (
              <p>
                {String(outcome.found)} module{outcome.found === 1 ? '' : 's'} found, {String(outcome.existing.length)} already in the library, {String(outcome.saved.length)} added as drafts.
                {outcome.dropped > 0 ? ` ${String(outcome.dropped)} dropped because no quoted sentence backed them or the page did not name the platform.` : ''}
              </p>
            )}
          {outcome.saved.length > 0 && (
            <ul>
              {outcome.saved.map((row) => (
                <li key={row.productId}><Link to={`${BASE}/products/${row.productId}`}>{row.product}</Link>. Draft, found by the Researcher. Its claims are waiting for review and it has no capability links yet.</li>
              ))}
            </ul>
          )}
          {outcome.existing.length > 0 && (
            <p>Already in the library and left as they are (use Part of on their own page to attach them): {outcome.existing.map((row) => row.product).join(', ')}.</p>
          )}
          {outcome.failed.length > 0 && (
            <ul>{outcome.failed.map((row) => <li key={row.product}>{row.product} could not be saved: {row.message}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  );
}
