import { Loading } from '../components/Loading/Loading';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { listChangeBranches } from '../../db/branches';
import { listDecisionsForModel } from '../../db/decisions';
import { refParamOf, type Ref } from '../../db/ref';
import type { BranchRow, DecisionRow } from '../../db/types';
import { useEditingBranch } from '../branches/useEditingBranch';
import { useMainBranch } from '../branches/useMainBranch';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../components/Text/Text';
import { moduleDisplayName } from '../elements/moduleDisplayName';
import { reportError } from '../errors/errorBannerStore';
import { useHomeSearch } from '../home/useHomeSearch';
import { supabase } from '../supabaseClient';
import { decisionStatusLabel } from '../decisions/decisionStatus';
import { matchTitled } from './searchAnywhereMatch';
import styles from './SearchDialog.module.css';

export interface SearchDialogProps {
  orgSlug: string;
  modelSlug: string;
  modelId: UUID;
  activeRef: Ref;
  onClose: () => void;
}

interface Option {
  id: string;
  group: 'Elements' | 'Changes' | 'Decisions' | 'Pages';
  label: string;
  detail: string;
  href: string;
  glyph?: React.ReactNode;
}

/**
 * F9 step 5 (UI-principles §2.0): "search anywhere" — one modal dialog,
 * opened by Ctrl/⌘-K or the nav's Search button, over the model's
 * elements (name and aliases — the same pool and ranking Home's search
 * box uses, `useHomeSearch`, overlaid with the change being edited),
 * changes and decisions. Grouped by kind, fully keyboard-operable (arrows
 * move, Enter opens, Esc closes — the native `<dialog>`'s own cancel), and
 * every result opens its canonical URL; an element opens at the current
 * ref. Rows come from RLS-scoped reads, so a viewer is never shown a
 * change or decision they couldn't open.
 *
 * Rendered only while open (`ModelNav` owns that state), so nothing here
 * loads until someone actually searches.
 */
export function SearchDialog({ orgSlug, modelSlug, modelId, activeRef, onClose }: SearchDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    if (!dialog.open) dialog.showModal();
    // A click on the backdrop lands on the <dialog> element itself, never on
    // its content — closing there matches every other overlay in the app.
    // Keyboard users close with Esc (the dialog's own cancel).
    const onClick = (event: MouseEvent) => {
      if (event.target === dialog) onClose();
    };
    dialog.addEventListener('click', onClick);
    return () => {
      dialog.removeEventListener('click', onClick);
    };
  }, [onClose]);

  const { branch: mainBranch } = useMainBranch(modelId);
  const { branch: editingBranch } = useEditingBranch(modelId, activeRef);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-label="Search"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {mainBranch ? (
        <SearchBody orgSlug={orgSlug} modelSlug={modelSlug} modelId={modelId} activeRef={activeRef} mainHeadCommitId={mainBranch.head_commit_id} branchCommitId={editingBranch?.kind === 'change' ? editingBranch.head_commit_id : null} onClose={onClose} />
      ) : (
        <div className={styles.body}>
          <Loading />
        </div>
      )}
    </dialog>
  );
}

function SearchBody({
  orgSlug,
  modelSlug,
  modelId,
  activeRef,
  mainHeadCommitId,
  branchCommitId,
  onClose,
}: Omit<SearchDialogProps, 'activeRef'> & { activeRef: Ref; mainHeadCommitId: UUID; branchCommitId: UUID | null }) {
  const navigate = useNavigate();
  const listboxId = useId();
  const optionIdPrefix = useId();
  const search = useHomeSearch(mainHeadCommitId, modelId, branchCommitId);
  const [changes, setChanges] = useState<BranchRow[] | null>(null);
  const [decisions, setDecisions] = useState<DecisionRow[] | null>(null);
  // The highlight belongs to the query it was set for, so a new query starts
  // at the first result again without an effect to reset it.
  const [highlight, setHighlight] = useState({ query: '', index: 0 });

  useEffect(() => {
    let cancelled = false;
    Promise.all([listChangeBranches(supabase, modelId), listDecisionsForModel(supabase, modelId)])
      .then(([branchRows, decisionRows]) => {
        if (cancelled) return;
        setChanges(branchRows);
        setDecisions(decisionRows);
      })
      .catch((e: unknown) => {
        reportError("Couldn't load changes and decisions to search.", e);
        if (!cancelled) {
          setChanges([]);
          setDecisions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  const base = `/o/${orgSlug}/m/${modelSlug}`;
  const query = search.query;

  const options: Option[] = useMemo(() => {
    const elementOptions: Option[] = search.results.map((row) => ({
      id: `e-${row.element.element_id}`,
      group: 'Elements',
      label: moduleDisplayName(row.element, row.parent),
      detail: row.element.element_type.replace('_', ' '),
      href: `${base}/e/${row.element.element_id}?ref=${refParamOf(activeRef)}`,
      glyph: <ElementTypeGlyph type={row.element.element_type} />,
    }));
    const changeOptions: Option[] = matchTitled(
      (changes ?? []).map((branch) => ({ branch, texts: [branch.title ?? branch.name, branch.name] })),
      query,
    ).map(({ branch }) => ({ id: `c-${branch.id}`, group: 'Changes', label: branch.title ?? branch.name, detail: `change · ${branch.status.replace('_', ' ')}`, href: `${base}/changes/${branch.id}` }));
    const decisionOptions: Option[] = matchTitled(
      (decisions ?? []).map((decision) => ({ decision, texts: [decision.title] })),
      query,
    ).map(({ decision }) => ({ id: `d-${decision.id}`, group: 'Decisions', label: decision.title, detail: `decision · ${decisionStatusLabel(decision.status)}`, href: `${base}/decisions/${decision.id}` }));
    // F15: the one place to jump straight to Ask Atlas — shown when the query matches "ask", "atlas" or "question".
    const pageOptions: Option[] = matchTitled([{ texts: ['Ask Atlas', 'ask a question', 'ai assistant'] }], query).length > 0 ? [{ id: 'p-ask', group: 'Pages', label: 'Ask Atlas', detail: 'page · ask a question about this model', href: `${base}/ask` }] : [];
    return [...elementOptions, ...changeOptions, ...decisionOptions, ...pageOptions];
  }, [search.results, changes, decisions, query, base, activeRef]);

  const activeIndex = highlight.query === query ? highlight.index : 0;
  const setActiveIndex = (update: (index: number) => number) => {
    setHighlight({ query, index: update(activeIndex) });
  };

  const open = (option: Option) => {
    // Close first: moving between two pages of the same kind keeps this
    // nav mounted, so the dialog wouldn't otherwise close by itself.
    onClose();
    void navigate(option.href);
  };

  const loading = query.trim() !== '' && (search.status === 'loading' || changes === null || decisions === null);
  const activeOption = options.at(Math.min(activeIndex, options.length - 1));
  const groups = (['Elements', 'Changes', 'Decisions', 'Pages'] as const).map((group) => ({ group, items: options.filter((o) => o.group === group) })).filter((g) => g.items.length > 0);

  return (
    <div className={styles.body}>
      <div className={styles.inputRow}>
        <Search size={18} aria-hidden="true" className={styles.inputIcon} />
        <input
          className={styles.input}
          type="text"
          role="combobox"
          aria-label="Search elements, changes and decisions"
          aria-expanded={options.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? `${optionIdPrefix}-${activeOption.id}` : undefined}
          placeholder="Search elements, changes and decisions…"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- opening this dialog is the request to type a search.
          autoFocus
          value={query}
          onChange={(event) => {
            search.setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && options.length > 0) {
              event.preventDefault();
              setActiveIndex((i) => (i + 1) % options.length);
            } else if (event.key === 'ArrowUp' && options.length > 0) {
              event.preventDefault();
              setActiveIndex((i) => (i - 1 + options.length) % options.length);
            } else if (event.key === 'Enter' && activeOption) {
              event.preventDefault();
              open(activeOption);
            }
          }}
        />
      </div>

      <div id={listboxId} role="listbox" aria-label="Results" className={styles.results}>
        {groups.map(({ group, items }) => (
          <div key={group} role="group" aria-label={group} className={styles.group}>
            <Text as="p" size="xs" tone="faint" className={styles.groupCaption} aria-hidden="true">
              {group}
            </Text>
            {items.map((option) => {
              const isActive = option === activeOption;
              return (
                // The combobox pattern: options are never focused themselves — the input keeps focus and points at the highlighted one with `aria-activedescendant`, and the input's own arrow/Enter handling is the keyboard route. The click is the pointer route to the same action.
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
                <div
                  key={option.id}
                  id={`${optionIdPrefix}-${option.id}`}
                  role="option"
                  aria-selected={isActive}
                  className={[styles.option, isActive ? styles.optionActive : ''].filter(Boolean).join(' ')}
                  onMouseMove={() => {
                    const index = options.indexOf(option);
                    if (index !== activeIndex) setActiveIndex(() => index);
                  }}
                  onClick={() => {
                    open(option);
                  }}
                >
                  {option.glyph}
                  <span className={styles.optionLabel}>{option.label}</span>
                  <Text as="span" size="sm" tone="muted" className={styles.optionDetail}>
                    {option.detail}
                  </Text>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className={styles.status} aria-live="polite">
        {query.trim() === '' ? (
          <Text tone="muted" size="sm">
            Type to find an element, change or decision. ↑↓ to move, Enter to open, Esc to close.
          </Text>
        ) : loading && options.length === 0 ? (
          <Text tone="muted" size="sm">
            Searching…
          </Text>
        ) : options.length === 0 ? (
          <Text tone="muted" size="sm">
            Nothing matches “{query.trim()}”.
          </Text>
        ) : (
          <Text tone="muted" size="sm">
            {options.length} result{options.length === 1 ? '' : 's'}
          </Text>
        )}
      </div>
    </div>
  );
}
