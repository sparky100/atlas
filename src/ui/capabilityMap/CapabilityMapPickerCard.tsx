import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { listCapabilityMapItems, type CapabilityMapItemRow, type CapabilityMapRow } from '../../db/capabilityMapTemplates';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { Text } from '../components/Text/Text';
import { buildCapabilityMapPreviewTree, type CapabilityMapPreviewNode } from './previewTree';
import { supabase } from '../supabaseClient';
import styles from './CapabilityMapPickerCard.module.css';

export interface CapabilityMapPickerCardProps {
  map: CapabilityMapRow;
  /** `true` while *any* map is importing (`useCapabilityImport`'s own single `status`, not per-card) — every card's own Import disables together, since only one import can be in flight for this model at a time. */
  importDisabled: boolean;
  onImport: (mapId: UUID) => void;
}

type PreviewState = { status: 'closed' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; tree: CapabilityMapPreviewNode[] };

function PreviewNodeView({ node }: { node: CapabilityMapPreviewNode }) {
  return (
    <li>
      <Text as="span" size="sm">
        {node.item.name}
      </Text>
      {node.item.description !== null && (
        <Text as="p" tone="muted" size="xs" className={styles.previewDescription}>
          {node.item.description}
        </Text>
      )}
      {node.children.length > 0 && (
        <ul className={styles.previewList}>
          {node.children.map((child) => (
            <PreviewNodeView key={child.item.code} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Sprint U4-2a item 4's picker card: `title`/`summary` on the face (with
 * a `sector v{version}` fallback for a row not yet reloaded since
 * 20260910010000 — `CapabilityMapRow`'s own doc comment), "Preview" (a
 * read-only tree, fetched lazily — the same `listCapabilityMapItems`
 * `useCapabilityImport.ts`'s own import step already uses, so a preview
 * can never show something different from what importing would actually
 * create) and "About this map" (provenance — `sourceDescription`, hidden
 * behind a disclosure rather than shown unconditionally, per this item's
 * own "provenance hidden behind info") as two independent
 * `CollapsibleSection`s — this codebase's own established disclosure
 * mechanism (`CollapsibleSection.tsx`'s own comment: "no tabs anywhere in
 * the product... this is the section-collapse mechanism that stands in
 * for tabs"), not a new modal/popover pattern this codebase has none of
 * yet. Import stays a plain, always-visible primary action, never behind
 * either disclosure.
 */
export function CapabilityMapPickerCard({ map, importDisabled, onImport }: CapabilityMapPickerCardProps) {
  const [preview, setPreview] = useState<PreviewState>({ status: 'closed' });

  function loadPreview(): void {
    if (preview.status === 'loading' || preview.status === 'ready') return;
    setPreview({ status: 'loading' });
    listCapabilityMapItems(supabase, map.id)
      .then((items: CapabilityMapItemRow[]) => {
        setPreview({ status: 'ready', tree: buildCapabilityMapPreviewTree(items) });
      })
      .catch((e: unknown) => {
        setPreview({ status: 'error', message: e instanceof Error ? e.message : 'Could not load a preview of this map.' });
      });
  }

  return (
    <li className={styles.card}>
      <div className={styles.header}>
        <Text as="h3" size="md">
          {map.title ?? `${map.sector} v${String(map.version)}`}
        </Text>
        {map.status === 'draft' && <Chip tone="neutral">Draft</Chip>}
      </div>
      <Text as="p" tone="muted" size="sm">
        {map.sector} v{map.version}
      </Text>
      {map.summary !== null && (
        <Text as="p" size="sm" className={styles.summary}>
          {map.summary}
        </Text>
      )}

      <div className={styles.actions}>
        <Button variant="secondary" disabled={importDisabled} onClick={() => { onImport(map.id); }}>
          {importDisabled ? 'Importing…' : 'Import'}
        </Button>
      </div>

      <CollapsibleSection
        title="Preview"
        defaultOpen={false}
        open={preview.status !== 'closed'}
        onOpenChange={(open) => {
          if (open) loadPreview();
          else setPreview({ status: 'closed' });
        }}
      >
        {preview.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {preview.status === 'error' && <Text as="p">{preview.message}</Text>}
        {preview.status === 'ready' && (
          <ul className={styles.previewList}>
            {preview.tree.map((node) => (
              <PreviewNodeView key={node.item.code} node={node} />
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="About this map" defaultOpen={false}>
        <Text as="p" tone="muted" size="sm">
          {map.source_description}
        </Text>
      </CollapsibleSection>
    </li>
  );
}
