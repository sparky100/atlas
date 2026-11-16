import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { attributeFieldSchema } from '../../contracts/attributeSchema';
import type { UUID } from '../../contracts/delta';
import { relationshipAttributeFieldSchema } from '../../contracts/relationshipAttributeSchema';
import { inboundRelationshipGroups } from '../../contracts/relationshipTypeRules';
import type { BranchRow } from '../../db/types';
import { Button } from '../components/Button/Button';
import { LinkButton } from '../components/Button/LinkButton';
import { RelationshipAdd } from '../components/RelationshipGroup/RelationshipAdd';
import { Text } from '../components/Text/Text';
import { GAP_ATTRIBUTE, gapItemQuestion, type GapItem, type GapKind } from './gaps';
import styles from './GapsView.module.css';

/** What the walk can ask its page to save — the page owns the branch, the source and the commit. */
export interface GapWalkSaver {
  saveAttribute: (item: GapItem, key: string, value: string) => Promise<string | null>;
  saveFit: (item: GapItem, value: string) => Promise<string | null>;
}

export interface GapWalkProps {
  kind: GapKind;
  /** Taken once when the walk opens, so an item filled mid-walk keeps its place rather than shifting the rest. */
  items: readonly GapItem[];
  saver: GapWalkSaver;
  /** For the owner gap's own "add an owner" control. */
  owner: { modelId: UUID; orgId: UUID; userId: UUID | null; branch: BranchRow; searchCommitId: UUID };
  elementHref: (elementId: UUID) => string;
  backHref: string;
  /** Called after each save, so the page can refresh its counts. */
  onFilled: () => void;
}

/** One option a pick key can choose: `value` is what gets saved, `label` what's shown. */
interface Choice {
  value: string;
  label: string;
}

function choicesFor(item: GapItem): Choice[] {
  const field =
    item.kind === 'fit'
      ? relationshipAttributeFieldSchema('supports', 'fitForPurpose')
      : GAP_ATTRIBUTE[item.kind]
        ? attributeFieldSchema(item.element.element_type, GAP_ATTRIBUTE[item.kind] ?? '')
        : undefined;
  return (field?.options ?? []).map((value) => ({ value, label: field?.optionLabels?.[value] ?? value }));
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
}

/**
 * F12 step 2: walking one gap's items with the keyboard, in the capture
 * review's own key vocabulary — a number key picks that choice and saves
 * it, moving straight on; `j`/`k` move to the next/previous item without
 * saving. Each save is its own commit (one value, one delta), so stopping
 * halfway loses nothing already answered.
 */
export function GapWalk({ kind, items, saver, owner, elementHref, backHref, onFilled }: GapWalkProps) {
  const [index, setIndex] = useState(0);
  const [filled, setFilled] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = index < items.length ? items[index] : undefined;
  const choices = useMemo(() => (item ? choicesFor(item) : []), [item]);

  const move = useCallback(
    (delta: number) => {
      setError(null);
      setIndex((i) => Math.max(0, Math.min(items.length, i + delta)));
    },
    [items.length],
  );

  const markFilled = useCallback(
    (key: string) => {
      setFilled((prev) => new Set(prev).add(key));
      onFilled();
      move(1);
    },
    [onFilled, move],
  );

  const choose = useCallback(
    async (choice: Choice) => {
      if (!item || saving) return;
      setSaving(true);
      setError(null);
      const attribute = GAP_ATTRIBUTE[item.kind];
      const failure = item.kind === 'fit' ? await saver.saveFit(item, choice.value) : attribute ? await saver.saveAttribute(item, attribute, choice.value) : 'Nothing to save for this gap.';
      setSaving(false);
      if (failure !== null) {
        setError(failure);
        return;
      }
      markFilled(item.key);
    },
    [item, saving, saver, markFilled],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j') {
        move(1);
        return;
      }
      if (e.key === 'k') {
        move(-1);
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
        const choice = choices[n - 1];
        if (choice) void choose(choice);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [move, choose, choices]);

  if (!item) {
    const skipped = items.length - filled.size;
    return (
      <section className={styles.walk} aria-label="Gap walk">
        <Text as="h2" size="xl">
          {filled.size === items.length ? 'All done' : 'End of the list'}
        </Text>
        <Text as="p">
          {String(filled.size)} filled{skipped > 0 ? `, ${String(skipped)} skipped` : ''}.
        </Text>
        <div className={styles.walkActions}>
          {items.length > 0 && (
            <Button
              onClick={() => {
                move(-items.length);
              }}
            >
              Back to the first
            </Button>
          )}
          <LinkButton to={backHref}>Back to all gaps</LinkButton>
        </div>
      </section>
    );
  }

  const ownsSlot = kind === 'owner' ? inboundRelationshipGroups(item.element.element_type).find((slot) => slot.relationshipType === 'owns') : undefined;

  return (
    <section className={styles.walk} aria-label="Gap walk">
      <Text as="span" size="sm" tone="muted">
        {String(index + 1)} of {String(items.length)}
        {filled.has(item.key) ? ' · filled' : ''}
      </Text>
      <Text as="h2" size="xl">
        {gapItemQuestion(item)}
      </Text>
      <Link to={elementHref(item.element.element_id)}>
        <Text as="span" size="sm">
          Open {item.name} →
        </Text>
      </Link>

      {choices.length > 0 && (
        <ol className={styles.choices} aria-label="Choices">
          {choices.map((choice, i) => (
            <li key={choice.value}>
              <Button
                disabled={saving}
                onClick={() => {
                  void choose(choice);
                }}
              >
                <kbd className={styles.key}>{String(i + 1)}</kbd> {choice.label}
              </Button>
            </li>
          ))}
        </ol>
      )}

      {kind === 'owner' && ownsSlot && (
        <div className={styles.ownerAdd}>
          <RelationshipAdd
            key={item.key}
            slot={ownsSlot}
            direction="inbound"
            elementId={item.element.element_id}
            elementType={item.element.element_type}
            elementName={item.element.name}
            existingRows={[]}
            relationshipFacts={new Map()}
            modelId={owner.modelId}
            orgId={owner.orgId}
            userId={owner.userId}
            searchCommitId={owner.searchCommitId}
            branch={owner.branch}
            expectedHeadCommitId={owner.branch.head_commit_id}
            onCreated={() => {
              markFilled(item.key);
            }}
          />
        </div>
      )}

      {error !== null && (
        <Text as="p" size="sm" className={styles.error}>
          {error}
        </Text>
      )}

      <div className={styles.walkActions}>
        <Button
          disabled={index === 0}
          onClick={() => {
            move(-1);
          }}
        >
          <kbd className={styles.key}>k</kbd> Previous
        </Button>
        <Button
          onClick={() => {
            move(1);
          }}
        >
          <kbd className={styles.key}>j</kbd> Skip
        </Button>
        <LinkButton to={backHref}>Back to all gaps</LinkButton>
      </div>
      <Text as="p" size="sm" tone="muted">
        {choices.length > 0 ? `Press 1–${String(choices.length)} to choose and move on; j moves to the next, k goes back.` : 'Add an owner to move on; j moves to the next, k goes back.'}
      </Text>
    </section>
  );
}
