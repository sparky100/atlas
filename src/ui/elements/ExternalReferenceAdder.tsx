import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { createAlias } from '../../db/aliases';
import { getOrCreateManualSource } from '../../db/sources';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import { normaliseExternalReference } from './externalReference';

export interface ExternalReferenceAdderProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID;
  elementId: UUID;
  onAdded: () => void;
}

/**
 * Adds an `external_ref` alias to this element — typically a backend hostname,
 * so a MuleSoft import can link consumers to this system (see
 * `listExternalRefMappings`). An element can have any number. Aliases are
 * model-wide and insert-only (SPEC §3.6), so this saves immediately, even on a
 * change branch, and there is no remove: the list above it is the record.
 */
export function ExternalReferenceAdder({ modelId, orgId, userId, elementId, onAdded }: ExternalReferenceAdderProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const aliasValue = normaliseExternalReference(value);
    if (aliasValue === null) {
      setError('Enter a hostname or reference, for example mprs.example.com.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
      await createAlias(supabase, { id: crypto.randomUUID(), orgId, modelId, elementId, aliasValue, aliasType: 'external_ref', sourceId: source.id, createdBy: userId });
      setValue('');
      setOpen(false);
      onAdded();
    } catch (e) {
      if (e instanceof Error && e.message.includes('aliases_model_id_alias_type_value_idx')) {
        setError('That reference is already recorded in this model, on this or another element.');
      } else {
        console.error('add external reference failed', e);
        setError("Couldn't save that reference. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        + Add an external reference
      </Button>
    );
  }

  return (
    <div>
      <Text as="label" size="sm" tone="muted">
        External reference: a backend hostname, or another system&rsquo;s id for this element
      </Text>
      <input
        type="text"
        value={value}
        placeholder="mprs.example.com"
        aria-label="External reference"
        disabled={saving}
        onChange={(e) => {
          setValue(e.target.value);
        }}
      />
      <Button variant="secondary" onClick={() => void add()} disabled={saving || value.trim() === ''}>
        {saving ? 'Saving…' : 'Add reference'}
      </Button>
      {error !== null && (
        <Text as="p" tone="default">
          {error}
        </Text>
      )}
    </div>
  );
}
