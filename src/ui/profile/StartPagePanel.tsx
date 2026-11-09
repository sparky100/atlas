import { useId } from 'react';
import { START_PAGES, type StartPage } from '../../contracts/userPreferences';
import type { UUID } from '../../contracts/delta';
import { Loading } from '../components/Loading/Loading';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { START_PAGE_LABELS } from './startPageLabels';
import { useStartPage } from './useStartPage';

const BY_ROLE = 'by-role';

/** Profile setting: which page the app opens on when you enter a model. Owners and architects start on Home and everyone else on the capability map unless they choose otherwise. */
export function StartPagePanel({ userId }: { userId: UUID }) {
  const { saved, loading, setStartPage } = useStartPage(userId);
  const selectId = useId();
  return (
    <Panel>
      <Text as="h2" size="lg">
        Start page
      </Text>
      {loading ? (
        <Loading />
      ) : (
        <>
          <label htmlFor={selectId}>
            <Text as="span" size="sm">
              Open a model on
            </Text>{' '}
            <select
              id={selectId}
              value={saved ?? BY_ROLE}
              onChange={(e) => {
                const value = e.target.value;
                setStartPage(START_PAGES.find((page) => page === value) ?? null);
              }}
            >
              <option value={BY_ROLE}>The default for my role</option>
              {START_PAGES.map((page: StartPage) => (
                <option key={page} value={page}>
                  {START_PAGE_LABELS[page]}
                </option>
              ))}
            </select>
          </label>
          <Text as="p" size="sm" tone="muted">
            Owners and architects start on Home; everyone else starts on the capability map. Your choice follows you across organisations.
          </Text>
        </>
      )}
    </Panel>
  );
}
