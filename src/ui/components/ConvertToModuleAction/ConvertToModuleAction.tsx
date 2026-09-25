import { useState } from 'react';
import { attributeFieldSchema } from '../../../contracts/attributeSchema';
import type { ElementsHeadRow } from '../../../contracts/rows';
import type { UUID } from '../../../contracts/delta';
import type { BranchRow } from '../../../db/types';
import { useConvertToModule } from '../../elements/useConvertToModule';
import { useConvertToModulePreview } from '../../elements/useConvertToModulePreview';
import { useRelationshipTargetSearch } from '../../elements/useRelationshipTargetSearch';
import { convertedRelationshipSentence } from './convertToModuleEffectSentences';
import { Button } from '../Button/Button';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../Text/Text';
import styles from './ConvertToModuleAction.module.css';

export interface ConvertToModuleTarget {
  elementId: UUID;
  name: string;
}

export interface ConvertToModuleActionProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  element: ElementsHeadRow;
  /** Endpoints of `element`'s own live relationships (`ElementPageData.relationshipEndpoints`) — every name the preview can possibly need, since the conversion only ever touches relationships that already touch `element`. */
  relationshipEndpoints: ReadonlyMap<UUID, ElementsHeadRow>;
  /** The target picker's own search pool — always main's real head, same reasoning `RetireAction.tsx`'s identical `searchCommitId` doc comment gives. */
  searchCommitId: UUID;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onConverted: (newContainerId: UUID) => void;
  onCancel: () => void;
}

/**
 * "Convert to a module of…" — a system that turns out to have been built on
 * an existing platform all along becomes one of its modules
 * (`src/engine/convertSystemToModule.ts`'s own module comment covers why
 * this needs to be a new operation rather than an `element.update` or a
 * merge). Picks another system as the target, previews exactly what
 * `useConvertToModulePreview` computes from the real engine builder (never
 * a second, hand-written approximation — CLAUDE.md rule 7), then commits
 * through `useConvertToModule`.
 *
 * The target search is deliberately *not* narrowed to `kind: 'platform'` —
 * there are several platform-like kinds (`SystemKind`: `platform`,
 * `integration_platform`, `data_platform`), and SPEC-data-model.md's own
 * "platforms and modules" amendment is explicit that a container's parent
 * has no kind requirement at all ("legal for any container… a parent-kind-
 * aware invariant would be more machinery than this feature needs" —
 * `relationshipTypeRules.ts`'s `supports(container, capability)` amendment
 * takes the identical stance). Every live system is a legal target, exactly
 * matching what the engine itself actually requires — unlike
 * `RelationshipAdd.tsx`'s own `via`-stage picker, which narrows to
 * `integration_platform` because `via` genuinely means nothing for any
 * other kind.
 */
export function ConvertToModuleAction({
  modelId,
  orgId,
  userId,
  element,
  relationshipEndpoints,
  searchCommitId,
  branch,
  expectedHeadCommitId,
  onConverted,
  onCancel,
}: ConvertToModuleActionProps) {
  const [target, setTarget] = useState<ConvertToModuleTarget | null>(null);
  const search = useRelationshipTargetSearch(searchCommitId, modelId, ['system'], element.element_id, target === null, branch.kind === 'change' ? branch.head_commit_id : null);
  const preview = useConvertToModulePreview(modelId, expectedHeadCommitId, element.element_id, target?.elementId ?? null);
  const { status, error, convert } = useConvertToModule({
    modelId,
    orgId,
    userId,
    systemId: element.element_id,
    branch,
    expectedHeadCommitId,
    onConverted,
  });

  const nameOf = (id: UUID): string => (target?.elementId === id ? target.name : (relationshipEndpoints.get(id)?.name ?? id));

  return (
    <div className={styles.panel}>
      <Text as="p" size="sm">
        Convert &ldquo;{element.name}&rdquo; into a module of another system? &ldquo;{element.name}&rdquo; is retracted; a new module with its own facts and relationships takes its place, and its old name stays searchable.
      </Text>

      {target ? (
        <Text as="p" size="sm">
          Converting into a module of <strong>{target.name}</strong>.{' '}
          <Button
            variant="ghost"
            onClick={() => {
              setTarget(null);
            }}
            disabled={status === 'converting'}
          >
            Change
          </Button>
        </Text>
      ) : (
        <div>
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- opening this panel is itself the request to search for a target system.
            autoFocus
            type="text"
            className={styles.input}
            placeholder="Search for the system this is a module of…"
            value={search.query}
            onChange={(e) => {
              search.setQuery(e.target.value);
            }}
          />
          {search.status === 'loading' && (
            <Text as="p" tone="muted" size="sm">
              Loading…
            </Text>
          )}
          {search.status === 'ready' && search.query.trim().length > 0 && search.results.length === 0 && (
            <Text as="p" tone="muted" size="sm">
              No systems match.
            </Text>
          )}
          {search.results.length > 0 && (
            <ul className={styles.results}>
              {search.results.map((result) => (
                <li key={result.element_id}>
                  <button
                    type="button"
                    className={styles.resultRow}
                    onClick={() => {
                      setTarget({ elementId: result.element_id, name: result.name });
                    }}
                  >
                    <ElementTypeGlyph type={result.element_type} />
                    <Text as="span">{result.name}</Text>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {target && (
        <>
          {preview.status === 'loading' && (
            <Text as="p" tone="muted" size="sm">
              Checking what this conversion would change…
            </Text>
          )}
          {preview.status === 'error' && preview.error && (
            <Text as="p" tone="default" size="sm">
              {preview.error}
            </Text>
          )}
          {preview.status === 'ready' && preview.preview && (
            <>
              <Text as="p" tone="muted" size="sm">
                This will change:
              </Text>
              <ul className={styles.goesList}>
                <li>
                  <Text as="span" size="sm">
                    {element.name} is retracted — its old name stays searchable as an alias of the new module.
                  </Text>
                </li>
                {preview.preview.relationships.map((item) => (
                  <li key={item.relationshipId}>
                    <Text as="span" size="sm">
                      {convertedRelationshipSentence(item, nameOf(item.otherElementId))}
                    </Text>
                  </li>
                ))}
                {preview.preview.droppedAttributeKeys.length > 0 && (
                  <li>
                    <Text as="span" size="sm">
                      A module has no field for{' '}
                      {preview.preview.droppedAttributeKeys.map((key) => attributeFieldSchema('system', key)?.label ?? key).join(', ')} — this system&rsquo;s own value{preview.preview.droppedAttributeKeys.length > 1 ? 's' : ''} will not carry over.
                    </Text>
                  </li>
                )}
              </ul>
            </>
          )}
        </>
      )}

      <div className={styles.actions}>
        <Button
          variant="primary"
          onClick={() => {
            if (target) void convert(target.elementId);
          }}
          disabled={!target || status === 'converting' || preview.status === 'loading'}
        >
          {status === 'converting' ? 'Converting…' : 'Convert'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={status === 'converting'}>
          Cancel
        </Button>
      </div>
      {error !== null && (
        <Text as="p" tone="default">
          {error}
        </Text>
      )}
    </div>
  );
}
