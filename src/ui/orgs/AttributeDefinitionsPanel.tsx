import { useId, useState } from 'react';
import { ELEMENT_TYPES, type ElementType, type UUID } from '../../contracts/delta';
import type { AttributeDefinitionKind } from '../../contracts/attributeSchema';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { useAttributeDefinitions } from './useAttributeDefinitions';
import styles from './AttributeDefinitionsPanel.module.css';

const KIND_OPTIONS: AttributeDefinitionKind[] = ['text', 'number', 'date', 'boolean', 'select', 'link'];

export interface AttributeDefinitionsPanelProps {
  orgId: UUID;
  userId: UUID | null;
}

/** `kind === 'select'` only — a plain comma-separated field, since no options-authoring UI exists anywhere in this app to mirror (core enum options are hard-coded, never user-authored). Trims each entry and drops empty ones. */
function parseOptions(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * F1 ("custom attributes") PR2: define, reorder, deprecate — the owner-only
 * settings surface `OrganisationSettingsView.tsx` mounts alongside its
 * other owner-gated panels (Invite by email, Delete), same "omitted
 * entirely for a non-owner, not shown disabled" convention this page's own
 * `canManage` gate already establishes for those.
 */
export function AttributeDefinitionsPanel({ orgId, userId }: AttributeDefinitionsPanelProps) {
  const { definitions, loading, error, create, moveUp, moveDown, deprecate, restore } = useAttributeDefinitions(orgId, userId);
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<AttributeDefinitionKind>('text');
  const [optionsText, setOptionsText] = useState('');
  const [appliesTo, setAppliesTo] = useState<ElementType[]>(['system']);
  const [required, setRequired] = useState(false);
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const keyId = useId();
  const labelId = useId();
  const kindId = useId();
  const optionsId = useId();
  const descriptionId = useId();

  const toggleAppliesTo = (type: ElementType) => {
    setAppliesTo((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  };

  const resetForm = () => {
    setKey('');
    setLabel('');
    setKind('text');
    setOptionsText('');
    setAppliesTo(['system']);
    setRequired(false);
    setDescription('');
  };

  return (
    <>
      <Text as="h2" size="lg">
        Custom attributes
      </Text>
      <Text as="p" tone="muted" size="sm">
        Org-defined attributes render after core attributes on every element page they apply to, with the same provenance and edit controls.
      </Text>

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          setFormError(null);
          const trimmedKey = key.trim();
          const trimmedLabel = label.trim();
          if (trimmedKey === '' || trimmedLabel === '') {
            setFormError('Key and label are required.');
            return;
          }
          if (appliesTo.length === 0) {
            setFormError('Choose at least one element type.');
            return;
          }
          const options = kind === 'select' ? parseOptions(optionsText) : null;
          if (kind === 'select' && (options === null || options.length === 0)) {
            setFormError('A select attribute needs at least one option.');
            return;
          }
          void create({
            key: trimmedKey,
            label: trimmedLabel,
            kind,
            options,
            appliesTo,
            required,
            description: description.trim() === '' ? null : description.trim(),
          }).then((result) => {
            if (!result) return;
            if (result.status === 'duplicate_key') {
              setFormError(`"${trimmedKey}" is already defined for this organisation.`);
            } else if (result.status === 'reserved_key') {
              setFormError(`"${trimmedKey}" is a core attribute key — choose a different key.`);
            } else {
              resetForm();
            }
          });
        }}
      >
        <label htmlFor={keyId}>
          <Text as="span" size="sm">
            Key
          </Text>
        </label>
        <input
          id={keyId}
          className={styles.input}
          type="text"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
          }}
        />

        <label htmlFor={labelId}>
          <Text as="span" size="sm">
            Label
          </Text>
        </label>
        <input
          id={labelId}
          className={styles.input}
          type="text"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
          }}
        />

        <label htmlFor={kindId}>
          <Text as="span" size="sm">
            Kind
          </Text>
        </label>
        <select
          id={kindId}
          className={styles.select}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as AttributeDefinitionKind);
          }}
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>

        {kind === 'select' && (
          <>
            <label htmlFor={optionsId}>
              <Text as="span" size="sm">
                Options (comma-separated)
              </Text>
            </label>
            <input
              id={optionsId}
              className={styles.input}
              type="text"
              value={optionsText}
              onChange={(e) => {
                setOptionsText(e.target.value);
              }}
            />
          </>
        )}

        <fieldset className={styles.appliesTo}>
          <legend>
            <Text as="span" size="sm">
              Applies to
            </Text>
          </legend>
          {ELEMENT_TYPES.map((type) => (
            <label key={type} className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={appliesTo.includes(type)}
                onChange={() => {
                  toggleAppliesTo(type);
                }}
              />
              {type}
            </label>
          ))}
        </fieldset>

        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => {
              setRequired(e.target.checked);
            }}
          />
          <Text as="span" size="sm">
            Required
          </Text>
        </label>

        <label htmlFor={descriptionId}>
          <Text as="span" size="sm">
            Description (optional)
          </Text>
        </label>
        <input
          id={descriptionId}
          className={styles.input}
          type="text"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
        />

        <Button variant="primary" type="submit">
          Define attribute
        </Button>
      </form>
      {formError !== null && <Text as="p">{formError}</Text>}
      {error !== null && <Text as="p">{error}</Text>}

      {!loading && definitions.length === 0 && <EmptyState>No custom attributes defined.</EmptyState>}
      {definitions.length > 0 && (
        <ul className={styles.list}>
          {definitions.map((definition, index) => (
            <li key={definition.id} className={styles.row}>
              <div className={styles.identity}>
                <Text as="span">{definition.label}</Text>
                <Chip tone="neutral">{definition.key}</Chip>
                <Chip tone="neutral">{definition.kind}</Chip>
                {definition.applies_to.map((type) => (
                  <Chip key={type} tone="neutral">
                    {type}
                  </Chip>
                ))}
                {definition.required && <Chip tone="warn">required</Chip>}
                {definition.deprecated_at !== null && <Chip tone="danger">deprecated</Chip>}
              </div>
              <div className={styles.actions}>
                <button type="button" aria-label={`Move ${definition.label} up`} disabled={index === 0} onClick={() => void moveUp(definition.id)}>
                  ↑
                </button>
                <button type="button" aria-label={`Move ${definition.label} down`} disabled={index === definitions.length - 1} onClick={() => void moveDown(definition.id)}>
                  ↓
                </button>
                {definition.deprecated_at === null ? (
                  <Button variant="ghost" onClick={() => void deprecate(definition.id)}>
                    Deprecate
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => void restore(definition.id)}>
                    Restore
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
