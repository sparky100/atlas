import { useCallback, useEffect, useState } from 'react';
import { isWebLink, validateElementLink } from '../../../contracts/elementLink';
import type { ElementLinkRow } from '../../../contracts/rows';
import type { UUID } from '../../../contracts/delta';
import { createElementLink, deleteElementLink, listElementLinks, updateElementLink } from '../../../db/elementLinks';
import { supabase } from '../../supabaseClient';
import { Button } from '../Button/Button';
import { EmptyState } from '../EmptyState/EmptyState';
import { Text } from '../Text/Text';
import styles from './DocumentsSection.module.css';

export interface DocumentsSectionProps {
  modelId: UUID;
  orgId: UUID;
  elementId: UUID;
  userId: UUID | null;
  /** Owners and architects only (ADR-030); the database enforces the real rule. */
  canManage: boolean;
  /** Reports the count to the section header. */
  onCount?: (count: number) => void;
}

/**
 * Documents (ADR-030): labelled pointers to where a document lives. Atlas
 * stores the name and the place, never the file. Changes here save straight
 * away and are not part of History.
 */
export function DocumentsSection({ modelId, orgId, elementId, userId, canManage, onCount }: DocumentsSectionProps) {
  const [links, setLinks] = useState<ElementLinkRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(() => {
    setReloadTick((t) => t + 1);
    return Promise.resolve();
  }, []);

  useEffect(() => {
    let cancelled = false;
    listElementLinks(supabase, modelId, elementId).then(
      (rows) => {
        if (cancelled) return;
        setLinks(rows);
        setLoadError(false);
        onCount?.(rows.length);
      },
      (e: unknown) => {
        if (cancelled) return;
        console.error('load documents failed', e);
        setLoadError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [modelId, elementId, onCount, reloadTick]);

  async function save(existing: ElementLinkRow | null, label: string, pointer: string): Promise<boolean> {
    const checked = validateElementLink({ label, pointer });
    if (!checked.ok) {
      setError(checked.error);
      return false;
    }
    if (userId === null) return false;
    try {
      if (existing) await updateElementLink(supabase, { id: existing.id, label, pointer, updatedBy: userId, now: new Date().toISOString() });
      else await createElementLink(supabase, { id: crypto.randomUUID(), orgId, modelId, elementId, label, pointer, addedBy: userId });
      setError(null);
      setEditing(null);
      await load();
      return true;
    } catch (e) {
      console.error('save document failed', e);
      setError("Couldn't save that document. Please try again.");
      return false;
    }
  }

  async function remove(id: string) {
    try {
      await deleteElementLink(supabase, id);
      setConfirmingRemove(null);
      await load();
    } catch (e) {
      console.error('remove document failed', e);
      setError("Couldn't remove that document. Please try again.");
    }
  }

  if (loadError) return <EmptyState>Couldn&rsquo;t load the documents. Please reload the page.</EmptyState>;
  if (links === null) return <Text as="p" tone="muted">Loading…</Text>;

  return (
    <div>
      {links.length === 0 && editing !== 'new' && (
        <EmptyState>{canManage ? 'No documents linked yet.' : 'No documents linked yet. An owner or architect can add them.'}</EmptyState>
      )}
      {links.length > 0 && (
        <ul className={styles.list}>
          {links.map((link) =>
            editing === link.id ? (
              <li key={link.id}>
                <DocumentForm
                  initial={link}
                  error={error}
                  onSave={(l, p) => save(link, l, p)}
                  onCancel={() => {
                    setEditing(null);
                    setError(null);
                  }}
                />
              </li>
            ) : (
              <li key={link.id} className={styles.row}>
                {isWebLink(link.pointer) ? (
                  <a href={link.pointer} target="_blank" rel="noopener noreferrer">
                    {link.label}
                  </a>
                ) : (
                  <Text as="span">{link.label}</Text>
                )}
                <Text as="span" size="sm" tone="muted" className={styles.pointer}>
                  {link.kind === 'link' ? 'Link' : 'Where to find it'}: {link.pointer}
                </Text>
                {canManage && (
                  <span className={styles.actions}>
                    <Button
                      variant="ghost"
                      aria-label={`Edit ${link.label}`}
                      onClick={() => {
                        setEditing(link.id);
                        setConfirmingRemove(null);
                        setError(null);
                      }}
                    >
                      Edit
                    </Button>
                    {confirmingRemove === link.id ? (
                      <>
                        <Button variant="destructive" aria-label={`Confirm remove ${link.label}`} onClick={() => void remove(link.id)}>
                          Remove it
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setConfirmingRemove(null);
                          }}
                        >
                          Keep it
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        aria-label={`Remove ${link.label}`}
                        onClick={() => {
                          setConfirmingRemove(link.id);
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {canManage &&
        (editing === 'new' ? (
          <DocumentForm
            initial={null}
            error={error}
            onSave={(l, p) => save(null, l, p)}
            onCancel={() => {
              setEditing(null);
              setError(null);
            }}
          />
        ) : (
          <Button
            variant="ghost"
            onClick={() => {
              setEditing('new');
              setError(null);
            }}
          >
            + Add a document
          </Button>
        ))}
      {error !== null && editing === null && <Text as="p">{error}</Text>}
    </div>
  );
}

function DocumentForm({ initial, error, onSave, onCancel }: { initial: ElementLinkRow | null; error: string | null; onSave: (label: string, pointer: string) => Promise<boolean>; onCancel: () => void }) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [pointer, setPointer] = useState(initial?.pointer ?? '');
  const [saving, setSaving] = useState(false);
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        setSaving(true);
        void onSave(label, pointer).finally(() => {
          setSaving(false);
        });
      }}
    >
      <label>
        <Text as="span" size="sm" tone="muted">
          Document name
        </Text>
        <input type="text" value={label} placeholder="Solution design" disabled={saving} onChange={(e) => { setLabel(e.target.value); }} />
      </label>
      <label>
        <Text as="span" size="sm" tone="muted">
          Link, or where to find it
        </Text>
        <input type="text" value={pointer} placeholder="https://… or SharePoint › Business cases" disabled={saving} onChange={(e) => { setPointer(e.target.value); }} />
      </label>
      {error !== null && <Text as="p">{error}</Text>}
      <div className={styles.formButtons}>
        <Button type="submit" variant="secondary" disabled={saving || label.trim() === '' || pointer.trim() === ''}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Add document'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
