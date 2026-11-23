import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type {
  CapabilitySetOption,
  CatalogueDraftContent,
  CatalogueDraftRow,
  CatalogueProductSummary,
} from '../../contracts/catalogueAdmin';
import {
  listCapabilitySets,
  listCatalogueProducts,
  publishCatalogueDraft,
  readCatalogueDraft,
  saveCatalogueDraft,
  validateCatalogueDraft,
} from '../../db/catalogueAdmin';
import { Loading } from '../components/Loading/Loading';
import { Text } from '../components/Text/Text';
import { useUnsavedChanges } from '../routes/platformAdmin/unsavedChanges';
import { supabase } from '../supabaseClient';
import { sectorLabel } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';

const BASE = '/platform-admin/catalogue';

/**
 * `/platform-admin/catalogue/sectors/:sector/drafts/:draftId` — one catalogue
 * draft: its title, the one published capability set it pins, and the
 * products selected from the library. Publishing writes the fixed entry
 * snapshots and lands on the new version.
 */
export function CatalogueDraftAdmin({ draftId }: { draftId: string }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<CatalogueDraftRow | null>(null);
  const [content, setContent] = useState<CatalogueDraftContent | null>(null);
  const [sets, setSets] = useState<CapabilitySetOption[]>([]);
  const [products, setProducts] = useState<CatalogueProductSummary[]>([]);
  const [search, setSearch] = useState('');
  const [issues, setIssues] = useState<string[] | null>(null);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [nextDraft, nextSets, nextProducts] = await Promise.all([
          readCatalogueDraft(supabase, draftId),
          listCapabilitySets(supabase),
          listCatalogueProducts(supabase),
        ]);
        setDraft(nextDraft);
        setContent(nextDraft.content);
        setSets(nextSets);
        setProducts(nextProducts);
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    })();
  }, [draftId]);

  const dirty = draft !== null && content !== null && JSON.stringify(content) !== JSON.stringify(draft.content);
  useUnsavedChanges(dirty);

  const sectorSets = useMemo(
    () => (draft === null ? [] : sets.filter((set) => set.sector === draft.sector).sort((a, b) => b.version - a.version)),
    [sets, draft],
  );
  const pinnedSet = content === null
    ? null
    : sets.find((set) => set.sector === content.sector && set.version === content.capabilityMapVersion) ?? null;
  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term === '') return products;
    return products.filter((product) => `${product.product} ${product.vendor} ${product.code}`.toLowerCase().includes(term));
  }, [products, search]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const addProduct = (id: string) => {
    if (content === null || content.productIds.includes(id)) return;
    setContent({ ...content, productIds: [...content.productIds, id] });
    setIssues(null);
  };

  const removeProduct = (id: string) => {
    if (content === null) return;
    setContent({ ...content, productIds: content.productIds.filter((productId) => productId !== id) });
    setIssues(null);
  };

  const save = () => void run(async () => {
    if (draft === null || content === null) return;
    const revision = await saveCatalogueDraft(supabase, draft, content);
    setDraft({ ...draft, content, edit_revision: revision });
    setNotice(`Catalogue draft saved (revision ${String(revision)}).`);
  });

  const validate = () => void run(async () => {
    if (content === null) return;
    const found = await validateCatalogueDraft(supabase, content);
    setIssues(found);
    setNotice(found.length === 0 ? 'Ready to publish. Save the draft before publishing.' : 'Resolve the catalogue issues.');
  });

  const publish = () => void run(async () => {
    if (draft === null || content === null || dirty || !issues || issues.length > 0) return;
    const id = await publishCatalogueDraft(supabase, draft);
    void navigate(`${BASE}/sectors/${draft.sector}/versions/${id}`);
  });

  const leave = (event: MouseEvent) => {
    if (draft === null || !dirty) return;
    event.preventDefault();
    if (window.confirm('You have unsaved changes. Leave without saving?')) {
      void navigate(`${BASE}/sectors/${draft.sector}`);
    }
  };

  if (loading) return <Loading />;
  if (loadError !== '' || draft === null || content === null) {
    return (
      <div className={styles.page}>
        <Link to={`${BASE}/sectors`} className={styles.backLink}>← Sector catalogues</Link>
        <p role="alert" className={styles.error}>{loadError !== '' ? loadError : 'This catalogue draft could not be loaded.'}</p>
      </div>
    );
  }

  return (
    <div className={styles.page} data-testid="catalogue-draft-admin">
      <Link to={`${BASE}/sectors/${draft.sector}`} className={styles.backLink} onClick={leave}>← {sectorLabel(draft.sector)}</Link>
      <div>
        <Text as="h1" size="2xl">{content.title}</Text>
        <Text as="p" tone="muted" size="sm">
          {sectorLabel(draft.sector)} · v{draft.version} draft · edited {new Date(draft.updated_at).toLocaleDateString('en-GB')}
        </Text>
      </div>

      <div className={[styles.actions, styles.stickyActions].filter(Boolean).join(' ')}>
        <button type="button" onClick={save} disabled={busy || !dirty}>Save draft</button>
        <button type="button" onClick={validate} disabled={busy}>Validate</button>
        <button type="button" onClick={publish} disabled={busy || dirty || issues === null || issues.length > 0}>Publish this version</button>
      </div>
      {dirty && <p role="status">Unsaved edits. Save before publishing or leaving this draft.</p>}
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {notice !== '' && <p role="status">{notice}</p>}

      <div className={styles.fields}>
        <label>Title <input value={content.title} onChange={(event) => { setContent({ ...content, title: event.target.value }); setIssues(null); }} /></label>
        <label>
          Capability set{' '}
          <select value={String(content.capabilityMapVersion)} onChange={(event) => { setContent({ ...content, capabilityMapVersion: Number(event.target.value) }); setIssues(null); }}>
            {sectorSets.map((set) => <option key={set.id} value={set.version}>v{set.version} · {set.title ?? 'Capability set'} ({set.status})</option>)}
          </select>
        </label>
        <label>Source description <textarea value={content.sourceDescription} onChange={(event) => { setContent({ ...content, sourceDescription: event.target.value }); setIssues(null); }} /></label>
      </div>

      <h2>Products in this version ({content.productIds.length})</h2>
      <p>
        The pinned set is v{content.capabilityMapVersion}
        {pinnedSet?.status === 'published' ? '' : ' (not published; validation will block publication)'}.
        Each product needs 1-10 links in this set.
      </p>
      <div className={styles.split}>
        <div className={styles.tree}>
          <label>Find a product <input value={search} onChange={(event) => { setSearch(event.target.value); }} placeholder="Name, vendor or code" /></label>
          <div className={styles.scroll}>
            {filteredProducts.map((product) => {
              const count = product.capabilityCountsByMap[pinnedSet?.id ?? ''] ?? 0;
              const chosen = content.productIds.includes(product.id);
              return (
                <div className={styles.pickRow} key={product.id}>
                  <span><strong>{product.product}</strong> <small>{product.vendor} · {count} link{count === 1 ? '' : 's'} in this set</small></span>
                  <button type="button" onClick={() => { if (chosen) removeProduct(product.id); else addProduct(product.id); }} disabled={busy}>{chosen ? 'Remove' : 'Add'}</button>
                </div>
              );
            })}
          </div>
        </div>
        <div className={styles.itemCard}>
          <h2>Chosen products</h2>
          {content.productIds.length === 0 && <p>No products chosen yet.</p>}
          {content.productIds.map((id) => {
            const product = products.find((candidate) => candidate.id === id);
            const count = product?.capabilityCountsByMap[pinnedSet?.id ?? ''] ?? 0;
            return (
              <div className={styles.linkRow} key={id}>
                <span><strong>{product?.product ?? 'Unknown product'}</strong> <small>{product?.vendor ?? ''} · {count} link{count === 1 ? '' : 's'} in this set</small></span>
                <button type="button" onClick={() => { removeProduct(id); }} disabled={busy}>Remove</button>
              </div>
            );
          })}
        </div>
      </div>
      {issues && <div className={styles.review} role="status"><h2>Publication review</h2>{issues.length ? <ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : <p>Validation passed. Save the draft, then publish.</p>}</div>}
    </div>
  );
}
