import { useCallback, useEffect, useMemo, useState } from 'react';
import { SECTORS, type Sector } from '../../contracts/capabilityMapContent';
import type { UUID } from '../../contracts/delta';
import type {
  CapabilitySetItem,
  CapabilitySetOption,
  CatalogueDraftContent,
  CatalogueDraftRow,
  CatalogueProductContent,
  CatalogueProductSummary,
  CatalogueVersionSummary,
} from '../../contracts/catalogueAdmin';
import {
  createCatalogueDraft,
  listCapabilitySetItems,
  listCapabilitySets,
  listCatalogueDrafts,
  listCatalogueEntries,
  listCatalogueProductIds,
  listCatalogueProducts,
  listCatalogueVersions,
  publishCatalogueDraft,
  readCatalogueProduct,
  saveCatalogueDraft,
  saveCatalogueProduct,
  validateCatalogueDraft,
  validateCatalogueProduct,
  withdrawCatalogue,
  type CatalogueEntryDetail,
  type CatalogueProductDetail,
} from '../../db/catalogueAdmin';
import { SettingsSection } from '../components/SettingsSection/SettingsSection';
import { supabase } from '../supabaseClient';
import styles from './CatalogueAdmin.module.css';

const CLAIM_KINDS = ['functional', 'deployment', 'licensing_model', 'support_end', 'integration'] as const;
const today = () => new Date().toISOString().slice(0, 10);
const sectorLabel = (sector: string) => sector.replaceAll('_', ' ');

/**
 * Platform admin: one canonical product library plus sector catalogue
 * publications. A product is edited once and can link to capabilities in any
 * number of capability-set versions. A catalogue draft only selects products
 * and pins a published set; publication writes the existing immutable entry
 * snapshots. All writes go through the guarded RPCs in
 * `src/db/catalogueAdmin.ts`, never direct table writes.
 */

function setLabel(set: CapabilitySetOption): string {
  return `${sectorLabel(set.sector)} · ${set.title ?? 'Capability set'} · v${String(set.version)}${set.status === 'published' ? '' : ` (${set.status})`}`;
}

function emptyProduct(): CatalogueProductContent {
  return { code: '', product: '', vendor: '', summary: '', capabilities: [], claims: [] };
}

export function CatalogueAdmin({ embedded = false }: { embedded?: boolean }) {
  const [products, setProducts] = useState<CatalogueProductSummary[]>([]);
  const [versions, setVersions] = useState<CatalogueVersionSummary[]>([]);
  const [drafts, setDrafts] = useState<CatalogueDraftRow[]>([]);
  const [sets, setSets] = useState<CapabilitySetOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<CatalogueProductDetail | null>(null);
  const [productContent, setProductContent] = useState<CatalogueProductContent | null>(null);
  const [productIssues, setProductIssues] = useState<string[] | null>(null);
  const [itemsBySet, setItemsBySet] = useState<Record<string, CapabilitySetItem[]>>({});
  const [linkMapId, setLinkMapId] = useState('');
  const [linkCode, setLinkCode] = useState('');
  const [linkHow, setLinkHow] = useState('');

  const [sector, setSector] = useState<Sector>('electricity_network');
  const [selectedDraft, setSelectedDraft] = useState<CatalogueDraftRow | null>(null);
  const [draftContent, setDraftContent] = useState<CatalogueDraftContent | null>(null);
  const [draftIssues, setDraftIssues] = useState<string[] | null>(null);
  const [draftSearch, setDraftSearch] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('');
  const [preview, setPreview] = useState<{ version: CatalogueVersionSummary; entries: CatalogueEntryDetail[] } | null>(null);

  const refresh = useCallback(async () => {
    const [nextProducts, nextVersions, nextDrafts, nextSets] = await Promise.all([
      listCatalogueProducts(supabase),
      listCatalogueVersions(supabase),
      listCatalogueDrafts(supabase),
      listCapabilitySets(supabase),
    ]);
    setProducts(nextProducts);
    setVersions(nextVersions);
    setDrafts(nextDrafts);
    setSets(nextSets);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh sets state only after its awaited reads.
    void refresh()
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { setLoading(false); });
  }, [refresh]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const productDirty = selectedProduct !== null && productContent !== null
    && JSON.stringify(productContent) !== JSON.stringify(selectedProduct.content);
  const draftDirty = selectedDraft !== null && draftContent !== null
    && JSON.stringify(draftContent) !== JSON.stringify(selectedDraft.content);

  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (term === '') return products;
    return products.filter((product) => `${product.product} ${product.vendor} ${product.code}`.toLowerCase().includes(term));
  }, [products, productSearch]);

  const sectorVersions = versions.filter((version) => version.sector === sector).sort((a, b) => b.version - a.version);
  const currentVersion = sectorVersions.find((version) => version.status === 'published' && version.withdrawn_at === null) ?? null;
  const sectorDrafts = drafts.filter((draft) => draft.sector === sector && draft.status === 'draft');
  const nextVersion = Math.max(0,
    ...versions.filter((version) => version.sector === sector).map((version) => version.version),
    ...drafts.filter((draft) => draft.sector === sector).map((draft) => draft.version)) + 1;
  const sectorSets = sets.filter((set) => set.sector === sector).sort((a, b) => b.version - a.version);
  const pinnedSet = draftContent === null ? null
    : sets.find((set) => set.sector === draftContent.sector && set.version === draftContent.capabilityMapVersion) ?? null;
  const filteredDraftProducts = useMemo(() => {
    const term = draftSearch.trim().toLowerCase();
    if (term === '') return products;
    return products.filter((product) => `${product.product} ${product.vendor} ${product.code}`.toLowerCase().includes(term));
  }, [products, draftSearch]);
  const setGroups = useMemo(() => {
    const groups = new Map<string, CapabilitySetOption[]>();
    for (const set of sets) {
      const group = groups.get(set.sector) ?? [];
      group.push(set);
      groups.set(set.sector, group);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [sets]);

  const openProduct = (id: UUID) => void run(async () => {
    const detail = await readCatalogueProduct(supabase, id);
    setSelectedProduct(detail); setProductContent(detail.content); setProductIssues(null);
  });

  const startProduct = () => {
    setSelectedProduct(null); setProductContent(emptyProduct()); setProductIssues(null);
  };

  const updateProduct = (patch: Partial<CatalogueProductContent>) => {
    setProductContent((content) => (content === null ? content : { ...content, ...patch }));
    setProductIssues(null);
  };

  const loadSetItems = (mapId: string) => {
    setLinkMapId(mapId); setLinkCode('');
    if (mapId === '' || itemsBySet[mapId] !== undefined) return;
    void run(async () => {
      const items = await listCapabilitySetItems(supabase, mapId);
      setItemsBySet((current) => ({ ...current, [mapId]: items }));
    });
  };

  const addCapabilityLink = () => {
    if (productContent === null || linkMapId === '' || linkCode === '' || linkHow.trim() === '') return;
    const item = (itemsBySet[linkMapId] ?? []).find((candidate) => candidate.code === linkCode);
    if (!item) return;
    if (productContent.capabilities.some((link) => link.capabilityMapId === linkMapId && link.capabilityCode === item.code)) return;
    updateProduct({ capabilities: [...productContent.capabilities, {
      capabilityMapId: linkMapId, capabilityCode: item.code, capabilityName: item.name, howItSupports: linkHow.trim(),
    }] });
    setLinkCode(''); setLinkHow('');
  };

  const removeCapabilityLink = (mapId: string, code: string) => {
    if (productContent === null) return;
    updateProduct({ capabilities: productContent.capabilities.filter((link) => !(link.capabilityMapId === mapId && link.capabilityCode === code)) });
  };

  const updateClaim = (index: number, patch: Partial<CatalogueProductContent['claims'][number]>) => {
    if (productContent === null) return;
    updateProduct({ claims: productContent.claims.map((claim, position) => position === index ? { ...claim, ...patch } : claim) });
  };

  const addClaim = () => {
    if (productContent === null) return;
    const position = Math.max(0, ...productContent.claims.map((claim) => claim.position)) + 1;
    updateProduct({ claims: [...productContent.claims, {
      position, kind: 'functional', statement: '', sourceUrl: '', sourceDate: today(), reviewedBy: '', reviewedAt: today(),
    }] });
  };

  const saveProduct = () => void run(async () => {
    if (productContent === null) return;
    const result = await saveCatalogueProduct(supabase, selectedProduct?.product.id ?? null,
      selectedProduct?.product.edit_revision ?? 0, productContent);
    const detail = await readCatalogueProduct(supabase, result.productId);
    setSelectedProduct(detail); setProductContent(detail.content); setProductIssues(null);
    await refresh();
    setNotice(`Product saved (revision ${String(result.revision)}).`);
  });

  const validateProduct = () => void run(async () => {
    if (productContent === null) return;
    const issues = await validateCatalogueProduct(supabase, productContent);
    setProductIssues(issues);
    setNotice(issues.length === 0 ? 'Product details are valid. Save before using it in a catalogue.' : 'Resolve the product issues.');
  });

  const createDraft = () => void run(async () => {
    const base = currentVersion;
    const baseProducts = base === null ? [] : await listCatalogueProductIds(supabase, base.id);
    const map = sectorSets.find((set) => set.status === 'published') ?? sectorSets[0];
    if (!map) throw new Error('Create a capability set for this sector first.');
    const content: CatalogueDraftContent = {
      sector, version: nextVersion, capabilityMapVersion: map.version,
      title: `${sectorLabel(sector)} product catalogue, version ${String(nextVersion)}`,
      sourceDescription: base === null
        ? 'Platform-reviewed product catalogue.'
        : `Products selected from ${base.title}, version ${String(base.version)}.`,
      productIds: baseProducts,
    };
    const id = await createCatalogueDraft(supabase, sector, nextVersion, base?.id ?? null, content);
    await refresh();
    const created = (await listCatalogueDrafts(supabase)).find((draft) => draft.id === id);
    if (!created) throw new Error('Draft created, but could not be loaded. Reload the page.');
    setSelectedDraft(created); setDraftContent(created.content); setDraftIssues(null); setPreview(null);
    setNotice(`${sectorLabel(sector)} v${String(nextVersion)} draft created.`);
  });

  const openDraft = (draft: CatalogueDraftRow) => {
    setSelectedDraft(draft); setDraftContent(draft.content); setDraftIssues(null); setPreview(null);
  };

  const saveDraft = () => void run(async () => {
    if (selectedDraft === null || draftContent === null) return;
    const revision = await saveCatalogueDraft(supabase, selectedDraft, draftContent);
    setSelectedDraft({ ...selectedDraft, content: draftContent, edit_revision: revision });
    await refresh();
    setNotice(`Catalogue draft saved (revision ${String(revision)}).`);
  });

  const validateDraft = () => void run(async () => {
    if (draftContent === null) return;
    const issues = await validateCatalogueDraft(supabase, draftContent);
    setDraftIssues(issues);
    setNotice(issues.length === 0 ? 'Ready to publish. Save the draft before publishing.' : 'Resolve the catalogue issues.');
  });

  const publishDraft = () => void run(async () => {
    if (selectedDraft === null || draftContent === null || draftDirty || draftIssues === null || draftIssues.length > 0) return;
    const id = await publishCatalogueDraft(supabase, selectedDraft);
    await refresh();
    setSelectedDraft(null); setDraftContent(null); setDraftIssues(null);
    setNotice(`Published ${sectorLabel(selectedDraft.sector)} v${String(selectedDraft.version)}. Catalogue ID: ${id}`);
  });

  const viewVersion = (version: CatalogueVersionSummary) => void run(async () => {
    setPreview({ version, entries: await listCatalogueEntries(supabase, version.id) });
  });

  const withdraw = () => void run(async () => {
    if (currentVersion === null || withdrawReason.trim() === '') return;
    await withdrawCatalogue(supabase, currentVersion.id, withdrawReason.trim());
    await refresh(); setWithdrawReason('');
    setNotice(`Withdrew ${sectorLabel(currentVersion.sector)} v${String(currentVersion.version)}.`);
  });

  const addProductToDraft = (id: UUID) => {
    if (draftContent === null || draftContent.productIds.includes(id)) return;
    setDraftContent({ ...draftContent, productIds: [...draftContent.productIds, id] });
    setDraftIssues(null);
  };

  const removeProductFromDraft = (id: UUID) => {
    if (draftContent === null) return;
    setDraftContent({ ...draftContent, productIds: draftContent.productIds.filter((productId) => productId !== id) });
    setDraftIssues(null);
  };

  if (loading) {
    const loadingBody = <p>Loading the product library.</p>;
    return embedded ? loadingBody : <SettingsSection id="catalogue" title="Product catalogue" summary="Loading">{loadingBody}</SettingsSection>;
  }

  const body = (
    <>
    <p>One product appears once here, with capability links into any number of capability sets. A sector catalogue is a fixed publication that selects products and pins one published capability set. Publishing does not change earlier versions, saved option citations or organisation models.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status">{notice}</p>}

    <section className={styles.panel} aria-label="Product library">
      <div className={styles.panelHeader}>
        <div>
          <h3>Product library</h3>
          <p>Edit the product, its evidence and every capability it supports. Reviewer names are internal to this admin view; they are not shown to catalogue readers.</p>
        </div>
        <button type="button" onClick={startProduct} disabled={busy || productDirty}>New product</button>
      </div>
      <div className={styles.controls}>
        <label>Find a product <input value={productSearch} onChange={(event) => { setProductSearch(event.target.value); }} placeholder="Name, vendor or code" /></label>
        <span>{String(filteredProducts.length)} shown</span>
      </div>
      <div className={styles.scroll} aria-label="Products">
        {filteredProducts.map((product) => <button type="button" key={product.id} className={selectedProduct?.product.id === product.id ? styles.active : ''} onClick={() => { openProduct(product.id); }} disabled={busy || productDirty}>
          <strong>{product.product}</strong> <small>{product.vendor} · {product.code}</small>
          <span>{product.capabilitySetCount} capability sets · {product.capabilityCount} links · {product.claimCount} claims</span>
        </button>)}
        {filteredProducts.length === 0 && <p>No products match.</p>}
      </div>
      {productDirty && <p role="status">Unsaved product edits. Save before switching products.</p>}

      {productContent && <div className={styles.editor}>
        <h4>{selectedProduct === null ? 'New product' : productContent.product || 'Product'}</h4>
        <div className={styles.fields}>
          <label>Product <input value={productContent.product} onChange={(event) => { updateProduct({ product: event.target.value }); }} /></label>
          <label>Vendor <input value={productContent.vendor} onChange={(event) => { updateProduct({ vendor: event.target.value }); }} /></label>
          <label>Stable code <input value={productContent.code} onChange={(event) => { updateProduct({ code: event.target.value }); }} placeholder="shopify-plus" /></label>
          <label>Summary <textarea value={productContent.summary} onChange={(event) => { updateProduct({ summary: event.target.value }); }} /></label>
        </div>

        <h5>Capability links ({productContent.capabilities.length})</h5>
        <p>Link the same product to capabilities in as many sets as it genuinely supports. Each link belongs to one exact capability-set version.</p>
        <div className={styles.linkForm}>
          <label>Capability set <select value={linkMapId} onChange={(event) => { loadSetItems(event.target.value); }}><option value="">Choose a set</option>{setGroups.map(([groupSector, groupSets]) => <optgroup key={groupSector} label={sectorLabel(groupSector)}>{groupSets.map((set) => <option key={set.id} value={set.id}>{set.title ?? 'Capability set'} · v{set.version}{set.status === 'published' ? '' : ` (${set.status})`}</option>)}</optgroup>)}</select></label>
          <label>Capability <select value={linkCode} onChange={(event) => { setLinkCode(event.target.value); }} disabled={linkMapId === ''}><option value="">Choose a capability</option>{(itemsBySet[linkMapId] ?? []).map((item) => <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}</select></label>
          <label>How it supports it <input value={linkHow} onChange={(event) => { setLinkHow(event.target.value); }} placeholder="Runs the online checkout" /></label>
          <button type="button" onClick={addCapabilityLink} disabled={busy || linkMapId === '' || linkCode === '' || linkHow.trim() === ''}>Add link</button>
        </div>
        <div className={styles.cards}>{Object.entries(productContent.capabilities.reduce<Record<string, CatalogueProductContent['capabilities']>>((groups, link) => {
          const group = groups[link.capabilityMapId] ?? [];
          group.push(link); groups[link.capabilityMapId] = group; return groups;
        }, {})).map(([mapId, links]) => {
          const set = sets.find((candidate) => candidate.id === mapId);
          return <div className={styles.itemCard} key={mapId}>
            <strong>{set ? setLabel(set) : 'Unknown capability set'}</strong>
            {links.map((link) => <div key={link.capabilityCode} className={styles.linkRow}>
              <span><strong>{link.capabilityName}</strong> <small>{link.capabilityCode}</small><br />{link.howItSupports}</span>
              <button type="button" onClick={() => { removeCapabilityLink(mapId, link.capabilityCode); }} disabled={busy}>Remove</button>
            </div>)}
          </div>;
        })}{productContent.capabilities.length === 0 && <p>No capability links yet. A catalogue entry needs 1-10 links in its pinned set.</p>}</div>

        <h5>Claims ({productContent.claims.length})</h5>
        <p>A claim is dated vendor evidence. Use a named reviewer and an HTTPS source; a catalogue entry needs 1-8 claims.</p>
        <div className={styles.cards}>{productContent.claims.map((claim, index) => <details className={styles.itemCard} key={index} open={claim.statement.trim() === ''}>
          <summary>{claim.statement.trim() === '' ? 'New claim' : claim.statement.slice(0, 70)}</summary>
          <div className={styles.claimGrid}>
            <label>Position <input type="number" min={1} value={claim.position} onChange={(event) => { updateClaim(index, { position: Number(event.target.value) }); }} /></label>
            <label>Kind <select value={claim.kind} onChange={(event) => { updateClaim(index, { kind: event.target.value as typeof claim.kind }); }}>{CLAIM_KINDS.map((kind) => <option key={kind} value={kind}>{kind.replaceAll('_', ' ')}</option>)}</select></label>
            <label>Source date <input type="date" value={claim.sourceDate} onChange={(event) => { updateClaim(index, { sourceDate: event.target.value }); }} /></label>
            <label>Reviewed on <input type="date" value={claim.reviewedAt} onChange={(event) => { updateClaim(index, { reviewedAt: event.target.value }); }} /></label>
            <label>Reviewed by (internal) <input value={claim.reviewedBy} onChange={(event) => { updateClaim(index, { reviewedBy: event.target.value }); }} /></label>
            <label>Source URL <input type="url" value={claim.sourceUrl} onChange={(event) => { updateClaim(index, { sourceUrl: event.target.value }); }} /></label>
          </div>
          <label>Statement <textarea value={claim.statement} onChange={(event) => { updateClaim(index, { statement: event.target.value }); }} /></label>
          <button type="button" onClick={() => { updateProduct({ claims: productContent.claims.filter((_, position) => position !== index) }); }} disabled={busy}>Remove claim</button>
        </details>)}</div>
        <div className={styles.actions}><button type="button" onClick={addClaim} disabled={busy}>Add claim</button><button type="button" onClick={saveProduct} disabled={busy}>Save product</button><button type="button" onClick={validateProduct} disabled={busy}>Validate product</button></div>
        {productIssues && <div className={styles.review} role="status"><h5>Product validation</h5>{productIssues.length ? <ul>{productIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : <p>Product details are valid.</p>}</div>}
      </div>}
    </section>

    <section className={styles.panel} aria-label="Catalogue versions">
      <div className={styles.panelHeader}><div><h3>Sector catalogue versions</h3><p>A published version is fixed. Corrections and additions are a new version; earlier versions stay readable by their citations.</p></div></div>
      <div className={styles.controls}>
        <label>Sector <select value={sector} onChange={(event) => { setSector(event.target.value as Sector); setSelectedDraft(null); setDraftContent(null); setDraftIssues(null); setPreview(null); }} disabled={busy}>{SECTORS.map((value) => <option key={value} value={value}>{sectorLabel(value)}</option>)}</select></label>
        <span>{currentVersion ? `Current: ${currentVersion.title} v${String(currentVersion.version)}` : 'No current published catalogue'}</span>
        {currentVersion && <button type="button" onClick={() => { viewVersion(currentVersion); }} disabled={busy}>View current products</button>}
        <button type="button" onClick={createDraft} disabled={busy || sectorDrafts.some((draft) => draft.status === 'draft')}>Create v{nextVersion} draft{currentVersion ? ' from current' : ''}</button>
      </div>
      {currentVersion?.withdrawn_at === null && <div className={styles.withdraw}>
        <label>Withdrawal reason <input value={withdrawReason} onChange={(event) => { setWithdrawReason(event.target.value); }} placeholder="Why this version is no longer current" /></label>
        <button type="button" onClick={withdraw} disabled={busy || withdrawReason.trim() === ''}>Withdraw current version</button>
      </div>}
      <details><summary>Versions for {sectorLabel(sector)} ({sectorVersions.length})</summary>
        <div className={styles.cards}>{sectorVersions.map((version) => <div className={styles.itemCard} key={version.id}>
          <strong>{version.title} · v{version.version}</strong>
          <span>{version.status === 'published' ? 'Published' : version.status} · capability set v{version.capability_map_version}</span>
          <span>{version.published_at ? `Published ${new Date(version.published_at).toLocaleDateString('en-GB')}` : 'Not published'}</span>
          {version.withdrawn_at && <span>Withdrawn {new Date(version.withdrawn_at).toLocaleDateString('en-GB')}: {version.withdrawn_reason}</span>}
          <button type="button" onClick={() => { viewVersion(version); }} disabled={busy}>View products</button>
        </div>)}</div>
      </details>
      {sectorDrafts.map((draft) => <button type="button" className={styles.draftButton} key={draft.id} onClick={() => { openDraft(draft); }} disabled={busy || draftDirty}>
        {draft.content.title} · v{draft.version} <small>Edited {new Date(draft.updated_at).toLocaleDateString('en-GB')}</small>
      </button>)}
      {draftDirty && <p role="status">Unsaved draft edits. Save before switching drafts or publishing.</p>}

      {preview && <div className={styles.preview} aria-label="Catalogue products">
        <div className={styles.panelHeader}><div><h4>{preview.version.title} · v{preview.version.version}</h4><p>{sectorLabel(preview.version.sector)} · capability set v{preview.version.capability_map_version} · {preview.entries.length} products</p></div><button type="button" onClick={() => { setPreview(null); }}>Close view</button></div>
        {preview.entries.map((entry) => <details className={styles.itemCard} key={entry.id}>
          <summary>{entry.product} · {entry.vendor} <small>{entry.code}</small></summary>
          <p>{entry.summary}</p>
          <h5>Capabilities in this set</h5>
          <ul>{entry.capabilities.map((capability) => <li key={capability.code}><strong>{capability.name}</strong> <small>{capability.code}</small> · {capability.howItSupports}</li>)}</ul>
          <h5>Claims</h5>
          <ul>{entry.claims.map((claim, index) => <li key={index}>{claim.statement} <small>{claim.kind} · {claim.sourceUrl} · source {claim.sourceDate} · reviewed by {claim.reviewedBy} on {claim.reviewedAt}</small></li>)}</ul>
        </details>)}
        {preview.entries.length === 0 && <p>No entries are visible in this version.</p>}
      </div>}

      {selectedDraft && draftContent && <div className={styles.editor}>
        <h4>{draftContent.title} · v{selectedDraft.version} draft</h4>
        <div className={styles.actions}><button type="button" onClick={saveDraft} disabled={busy || !draftDirty}>Save draft</button><button type="button" onClick={validateDraft} disabled={busy}>Validate</button><button type="button" onClick={publishDraft} disabled={busy || draftDirty || draftIssues === null || draftIssues.length > 0}>Publish this version</button></div>
        <div className={styles.fields}>
          <label>Title <input value={draftContent.title} onChange={(event) => { setDraftContent({ ...draftContent, title: event.target.value }); setDraftIssues(null); }} /></label>
          <label>Capability set <select value={String(draftContent.capabilityMapVersion)} onChange={(event) => { setDraftContent({ ...draftContent, capabilityMapVersion: Number(event.target.value) }); setDraftIssues(null); }}>{sectorSets.map((set) => <option key={set.id} value={set.version}>v{set.version} · {set.title ?? 'Capability set'} ({set.status})</option>)}</select></label>
          <label>Source description <textarea value={draftContent.sourceDescription} onChange={(event) => { setDraftContent({ ...draftContent, sourceDescription: event.target.value }); setDraftIssues(null); }} /></label>
        </div>

        <h5>Products in this version ({draftContent.productIds.length})</h5>
        <p>The pinned set is v{draftContent.capabilityMapVersion}{pinnedSet?.status === 'published' ? '' : ' (not published; validation will block publication)'}. Each product needs 1-10 links in this set.</p>
        <div className={styles.split}>
          <div className={styles.tree}>
            <label>Find a product <input value={draftSearch} onChange={(event) => { setDraftSearch(event.target.value); }} placeholder="Name, vendor or code" /></label>
            <div className={styles.scroll}>{filteredDraftProducts.map((product) => {
              const count = product.capabilityCountsByMap[pinnedSet?.id ?? ''] ?? 0;
              const chosen = draftContent.productIds.includes(product.id);
              return <div className={styles.pickRow} key={product.id}>
                <span><strong>{product.product}</strong> <small>{product.vendor} · {count} link{count === 1 ? '' : 's'} in this set</small></span>
                <button type="button" onClick={() => { if (chosen) removeProductFromDraft(product.id); else addProductToDraft(product.id); }} disabled={busy}>{chosen ? 'Remove' : 'Add'}</button>
              </div>;
            })}</div>
          </div>
          <div className={styles.itemCard}>
            <h5>Chosen products</h5>
            {draftContent.productIds.length === 0 && <p>No products chosen yet.</p>}
            {draftContent.productIds.map((id) => {
              const product = products.find((candidate) => candidate.id === id);
              const count = product?.capabilityCountsByMap[pinnedSet?.id ?? ''] ?? 0;
              return <div className={styles.linkRow} key={id}>
                <span><strong>{product?.product ?? 'Unknown product'}</strong> <small>{product?.vendor ?? ''} · {count} link{count === 1 ? '' : 's'} in this set</small></span>
                <button type="button" onClick={() => { removeProductFromDraft(id); }} disabled={busy}>Remove</button>
              </div>;
            })}
          </div>
        </div>
        {draftIssues && <div className={styles.review} role="status"><h5>Publication review</h5>{draftIssues.length ? <ul>{draftIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : <p>Validation passed. Save the draft, then publish.</p>}</div>}
      </div>}
    </section>
    </>
  );

  return embedded ? body : (
    <SettingsSection id="catalogue" title="Product catalogue" summary={`${String(products.length)} products · ${String(versions.filter((version) => version.status === 'published' && version.withdrawn_at === null).length)} current catalogues · ${String(drafts.filter((draft) => draft.status === 'draft').length)} drafts`}>
      {body}
    </SettingsSection>
  );
}
