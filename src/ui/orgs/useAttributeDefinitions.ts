import { useEffect, useState } from 'react';
import type { ElementType, UUID } from '../../contracts/delta';
import type { AttributeDefinitionKind } from '../../contracts/attributeSchema';
import {
  createAttributeDefinition,
  deprecateAttributeDefinition,
  listAttributeDefinitions,
  restoreAttributeDefinition,
  setAttributeDefinitionOrder,
  type CreateAttributeDefinitionResult,
} from '../../db/attributeDefinitions';
import type { AttributeDefinitionRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface NewAttributeDefinitionInput {
  key: string;
  label: string;
  kind: AttributeDefinitionKind;
  options: readonly string[] | null;
  appliesTo: readonly ElementType[];
  required: boolean;
  description: string | null;
}

export interface UseAttributeDefinitionsResult {
  definitions: AttributeDefinitionRow[];
  loading: boolean;
  error: string | null;
  /** `null` on a real failure (already reported); the result's own `status` distinguishes 'created' from 'duplicate_key'/'reserved_key', shown inline by the caller — same convention `useInvites.ts`'s own `create` established. */
  create: (input: NewAttributeDefinitionInput) => Promise<CreateAttributeDefinitionResult | null>;
  moveUp: (id: UUID) => Promise<void>;
  moveDown: (id: UUID) => Promise<void>;
  deprecate: (id: UUID) => Promise<void>;
  restore: (id: UUID) => Promise<void>;
}

/**
 * F1 ("custom attributes") PR2 — list plus the four mutations (create,
 * reorder via two-step `setAttributeDefinitionOrder` swaps, deprecate,
 * restore). Same reload-after-mutation shape `useMembers.ts`/`useInvites.ts`
 * already established for a settings-page list: no optimistic local
 * editing, since a swap or a duplicate-key create can be refused
 * server-side and the re-fetched list is the source of truth for what
 * actually happened.
 */
export function useAttributeDefinitions(orgId: UUID | null, userId: UUID | null): UseAttributeDefinitionsResult {
  const [definitions, setDefinitions] = useState<AttributeDefinitionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!orgId) {
      setDefinitions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listAttributeDefinitions(supabase, orgId)
      .then((rows) => {
        if (!cancelled) setDefinitions(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load attribute definitions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // reloadToken is a deliberate refetch trigger, not a value the effect
    // reads — the react-hooks plugin only runs on .tsx files (eslint.config.js).
  }, [orgId, reloadToken]);

  const create = async (input: NewAttributeDefinitionInput): Promise<CreateAttributeDefinitionResult | null> => {
    if (!orgId || !userId) return null;
    setError(null);
    try {
      const result = await createAttributeDefinition(supabase, {
        id: crypto.randomUUID(),
        orgId,
        key: input.key,
        label: input.label,
        kind: input.kind,
        options: input.options,
        appliesTo: input.appliesTo,
        required: input.required,
        description: input.description,
        // Append at the end of the currently-loaded display order — the
        // same "caller's own current list length" the type's own doc
        // comment names.
        orderIndex: definitions.length,
        createdBy: userId,
      });
      setReloadToken((t) => t + 1);
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not define this attribute.';
      setError(message);
      reportError('Could not define this attribute.', e);
      return null;
    }
  };

  /** Swaps `id`'s own `order_index` with its neighbour at `offset` (-1 for up, +1 for down) in the currently-loaded, already-ordered list. A no-op past either end. */
  const swapWithNeighbour = async (id: UUID, offset: -1 | 1) => {
    if (!orgId) return;
    const index = definitions.findIndex((d) => d.id === id);
    const neighbourIndex = index + offset;
    if (index === -1 || neighbourIndex < 0 || neighbourIndex >= definitions.length) return;
    const current = definitions[index];
    const neighbour = definitions[neighbourIndex];
    if (!current || !neighbour) return;
    setError(null);
    try {
      await setAttributeDefinitionOrder(supabase, current.id, neighbour.order_index);
      await setAttributeDefinitionOrder(supabase, neighbour.id, current.order_index);
      setReloadToken((t) => t + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not reorder this attribute.';
      setError(message);
      reportError('Could not reorder this attribute.', e);
    }
  };

  const moveUp = (id: UUID) => swapWithNeighbour(id, -1);
  const moveDown = (id: UUID) => swapWithNeighbour(id, 1);

  const deprecate = async (id: UUID) => {
    setError(null);
    try {
      await deprecateAttributeDefinition(supabase, id);
      setReloadToken((t) => t + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not deprecate this attribute.';
      setError(message);
      reportError('Could not deprecate this attribute.', e);
    }
  };

  const restore = async (id: UUID) => {
    setError(null);
    try {
      await restoreAttributeDefinition(supabase, id);
      setReloadToken((t) => t + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not restore this attribute.';
      setError(message);
      reportError('Could not restore this attribute.', e);
    }
  };

  return { definitions, loading, error, create, moveUp, moveDown, deprecate, restore };
}
