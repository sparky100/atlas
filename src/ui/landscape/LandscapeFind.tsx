import { useId, useMemo, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { matchTitled } from '../search/searchAnywhereMatch';
import styles from './LandscapeFind.module.css';

export interface LandscapeFindOption {
  elementId: UUID;
  name: string;
  /** What kind of thing it is ("system", "actor") — shown beside the name so two like-named tiles can be told apart. */
  detail: string;
}

export interface LandscapeFindProps {
  /** Every tile currently drawn — never an element a filter or a collapsed lane has hidden, so choosing one always lands on something. */
  options: readonly LandscapeFindOption[];
  /** Focus this element and bring it into view. */
  onPick: (elementId: UUID) => void;
}

const MAX_RESULTS = 8;

/**
 * "Find on this landscape": type part of a name, pick a match, and the
 * canvas focuses that tile (fading the rest, showing only its own
 * connections — the same focus a click gives) and centres it. The landscape
 * can hold hundreds of tiles; panning to look for one is the thing this
 * replaces. Keyboard: ↑/↓ to move, Enter to pick, Escape to clear.
 */
export function LandscapeFind({ options, onPick }: LandscapeFindProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const matches = useMemo(() => matchTitled(options.map((option) => ({ option, texts: [option.name] })), query, MAX_RESULTS).map(({ option }) => option), [options, query]);
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));
  const open = query.trim() !== '';

  function pick(option: LandscapeFindOption): void {
    onPick(option.elementId);
    setQuery('');
    setActive(0);
  }

  return (
    <div className={styles.find}>
      <input
        className={styles.input}
        type="search"
        role="combobox"
        aria-label="Find on this landscape"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && matches[activeIndex] ? `${listId}-${matches[activeIndex].elementId}` : undefined}
        placeholder="Find a system…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && matches.length > 0) {
            e.preventDefault();
            setActive(Math.min(activeIndex + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp' && matches.length > 0) {
            e.preventDefault();
            setActive(Math.max(activeIndex - 1, 0));
          } else if (e.key === 'Enter') {
            const chosen = matches[activeIndex];
            if (chosen) {
              e.preventDefault();
              pick(chosen);
            }
          } else if (e.key === 'Escape' && query !== '') {
            e.preventDefault();
            e.stopPropagation();
            setQuery('');
          }
        }}
      />
      {open && (
        <ul id={listId} className={styles.list} role="listbox" aria-label="Matches on this landscape">
          {matches.length === 0 ? (
            <li className={styles.empty}>Nothing on this landscape matches. A filter or a collapsed lane may be hiding it.</li>
          ) : (
            matches.map((option, index) => (
              <li
                key={option.elementId}
                id={`${listId}-${option.elementId}`}
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? styles.optionActive : styles.option}
                onMouseDown={(e) => {
                  // Before the input loses focus, so the pick lands.
                  e.preventDefault();
                  pick(option);
                }}
              >
                <span>{option.name}</span>
                <span className={styles.detail}>{option.detail}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
