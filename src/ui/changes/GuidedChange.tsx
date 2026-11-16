import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../components/Text/Text';
import { moduleDisplayName } from '../elements/moduleDisplayName';
import { SYSTEM_OR_MODULE_TYPES, useRelationshipTargetSearch } from '../elements/useRelationshipTargetSearch';
import draftStyles from './DraftWithAi.module.css';

export type GuidedChangeKind = 'add' | 'retire' | 'details';

export interface GuidedChangeStart {
  kind: GuidedChangeKind;
  /** The system picked for "retire" and "details"; `null` for "add". */
  system: { id: UUID; name: string } | null;
}

interface GuidedChangeProps {
  modelId: UUID;
  commitId: UUID;
  busy: boolean;
  onStart: (start: GuidedChangeStart) => void;
}

const PICKER_TITLE: Record<Exclude<GuidedChangeKind, 'add'>, string> = {
  retire: 'Which system is being retired?',
  details: 'Which system are you changing?',
};

/**
 * The standard changes that need no AI. Each one is exact, so each opens the
 * screen the app already has for it, on a new change: "Add a new system" opens
 * the search-and-add box, "Retire a system" opens the same Retire panel as a
 * system's own page (which asks whether it is replaced by an existing system,
 * a new one, or nothing), and "Change details" opens that system's edit form.
 */
export function GuidedChange({ modelId, commitId, busy, onStart }: GuidedChangeProps) {
  const [picking, setPicking] = useState<Exclude<GuidedChangeKind, 'add'> | null>(null);
  const search = useRelationshipTargetSearch(commitId, modelId, SYSTEM_OR_MODULE_TYPES, '00000000-0000-0000-0000-000000000000', picking !== null);

  if (picking !== null) {
    return (
      <section className={draftStyles.block} aria-label={PICKER_TITLE[picking]}>
        <Text as="p" size="sm">
          {PICKER_TITLE[picking]}
        </Text>
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- choosing this change is itself the request to search.
          autoFocus
          type="text"
          placeholder="Search systems and modules…"
          aria-label="Search systems and modules"
          value={search.query}
          disabled={busy}
          onChange={(event) => {
            search.setQuery(event.target.value);
          }}
        />
        {search.status === 'loading' && (
          <Text as="p" tone="muted" size="sm">
            Loading…
          </Text>
        )}
        {search.status === 'error' && <p role="alert">Could not load the list. Try again in a moment.</p>}
        {search.results.length > 0 && (
          <ul className={draftStyles.results}>
            {search.results.map((result) => {
              const name = moduleDisplayName(result, search.resultParents.get(result.element_id) ?? null);
              return (
                <li key={result.element_id}>
                  <button
                    type="button"
                    className={draftStyles.resultButton}
                    disabled={busy}
                    onClick={() => {
                      onStart({ kind: picking, system: { id: result.element_id, name } });
                    }}
                  >
                    <ElementTypeGlyph type={result.element_type} /> {name}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {search.status === 'ready' && search.results.length === 0 && (
          <Text as="p" tone="muted" size="sm">
            {search.query.trim() === '' ? 'This model has no systems yet.' : 'Nothing found. Check the spelling.'}
          </Text>
        )}
        <div>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setPicking(null);
              search.setQuery('');
            }}
          >
            Back
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className={draftStyles.block} aria-label="Standard changes">
      <Text as="p" size="sm">
        Standard changes: pick one and Atlas starts the change and opens the right screen. No AI needed.
      </Text>
      <div className={draftStyles.pills} role="group" aria-label="Standard changes">
        <button
          type="button"
          className={draftStyles.pill}
          disabled={busy}
          onClick={() => {
            onStart({ kind: 'add', system: null });
          }}
        >
          Add a new system
        </button>
        <button
          type="button"
          className={draftStyles.pill}
          disabled={busy}
          onClick={() => {
            setPicking('retire');
          }}
        >
          Retire a system
        </button>
        <button
          type="button"
          className={draftStyles.pill}
          disabled={busy}
          onClick={() => {
            setPicking('details');
          }}
        >
          Change details of a system
        </button>
      </div>
    </section>
  );
}
