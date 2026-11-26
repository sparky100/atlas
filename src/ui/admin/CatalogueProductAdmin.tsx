import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type {
  CapabilitySetItem,
  CapabilitySetOption,
  CatalogueProductContent,
} from '../../contracts/catalogueAdmin';
import {
  listCapabilitySetItems,
  listCapabilitySets,
  readCatalogueProduct,
  saveCatalogueProduct,
  validateCatalogueProduct,
  type CatalogueProductDetail,
} from '../../db/catalogueAdmin';
import { Loading } from '../components/Loading/Loading';
import { Text } from '../components/Text/Text';
import { useUnsavedChanges } from '../routes/platformAdmin/unsavedChanges';
import { supabase } from '../supabaseClient';
import { claimStatusText, emptyProduct, sameClaimText, sectorLabel, setLabel } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';

const BASE = '/platform-admin/catalogue';
const CLAIM_KINDS = ['functional', 'deployment', 'licensing_model', 'support_end', 'integration'] as const;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * `/platform-admin/catalogue/products/:productId` (and `/new`) — one product
 * in the canonical library: its details, the exact capability-set versions it
 * supports and its dated claims. The reviewer is recorded automatically for
 * audit; it is never entered or shown here.
 */
export function CatalogueProductAdmin({ productId }: { productId: string | null }) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<CatalogueProductDetail | null>(null);
  const [content, setContent] = useState<CatalogueProductContent | null>(null);
  const [sets, setSets] = useState<CapabilitySetOption[]>([]);
  const [itemsBySet, setItemsBySet] = useState<Record<string, CapabilitySetItem[]>>({});
  const [linkMapId, setLinkMapId] = useState('');
  const [linkCode, setLinkCode] = useState('');
  const [linkHow, setLinkHow] = useState('');
  const [issues, setIssues] = useState<string[] | null>(null);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [nextSets, nextDetail] = await Promise.all([
          listCapabilitySets(supabase),
          productId === null ? Promise.resolve(null) : readCatalogueProduct(supabase, productId),
        ]);
        setSets(nextSets);
        setDetail(nextDetail);
        setContent(nextDetail === null ? emptyProduct() : nextDetail.content);
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    })();
  }, [productId]);

  const dirty = content !== null && JSON.stringify(content) !== JSON.stringify(detail?.content ?? emptyProduct());
  useUnsavedChanges(dirty);

  const setGroups = useMemo(() => {
    const groups = new Map<string, CapabilitySetOption[]>();
    for (const set of sets) {
      const group = groups.get(set.sector) ?? [];
      group.push(set);
      groups.set(set.sector, group);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [sets]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const updateProduct = (patch: Partial<CatalogueProductContent>) => {
    setContent((current) => (current === null ? current : { ...current, ...patch }));
    setIssues(null);
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
    if (content === null || linkMapId === '' || linkCode === '' || linkHow.trim() === '') return;
    const item = (itemsBySet[linkMapId] ?? []).find((candidate) => candidate.code === linkCode);
    if (!item) return;
    if (content.capabilities.some((link) => link.capabilityMapId === linkMapId && link.capabilityCode === item.code)) return;
    updateProduct({ capabilities: [...content.capabilities, {
      capabilityMapId: linkMapId, capabilityCode: item.code, capabilityName: item.name, howItSupports: linkHow.trim(),
    }] });
    setLinkCode(''); setLinkHow('');
  };

  const removeCapabilityLink = (mapId: string, code: string) => {
    if (content === null) return;
    updateProduct({ capabilities: content.capabilities.filter((link) => !(link.capabilityMapId === mapId && link.capabilityCode === code)) });
  };

  const updateClaim = (index: number, patch: Partial<CatalogueProductContent['claims'][number]>) => {
    if (content === null) return;
    updateProduct({ claims: content.claims.map((claim, position) => position === index ? { ...claim, ...patch } : claim) });
  };

  const addClaim = () => {
    if (content === null) return;
    const position = Math.max(0, ...content.claims.map((claim) => claim.position)) + 1;
    updateProduct({ claims: [...content.claims, {
      position, kind: 'functional', statement: '', sourceUrl: '', sourceDate: today(),
    }] });
  };

  const save = () => void run(async () => {
    if (content === null) return;
    const result = await saveCatalogueProduct(supabase, detail?.product.id ?? null,
      detail?.product.edit_revision ?? 0, content);
    const next = await readCatalogueProduct(supabase, result.productId);
    setDetail(next); setContent(next.content); setIssues(null);
    setNotice(`Product saved (revision ${String(result.revision)}).${result.reviewed > 0 ? ` ${String(result.reviewed)} claim${result.reviewed === 1 ? '' : 's'} marked as reviewed by you.` : ''}`);
    if (productId === null) void navigate(`${BASE}/products/${result.productId}`, { replace: true });
  });

  const validate = () => void run(async () => {
    if (content === null) return;
    const found = await validateCatalogueProduct(supabase, content);
    setIssues(found);
    setNotice(found.length === 0 ? 'Product details are valid. Save before using it in a catalogue.' : 'Resolve the product issues.');
  });

  const leave = (event: MouseEvent) => {
    if (!dirty) return;
    event.preventDefault();
    if (window.confirm('You have unsaved changes. Leave without saving?')) void navigate(BASE);
  };

  if (loading) return <Loading />;
  if (loadError !== '' || content === null) {
    return (
      <div className={styles.page}>
        <Link to={BASE} className={styles.backLink}>← Product catalogue</Link>
        <p role="alert" className={styles.error}>{loadError !== '' ? loadError : 'This product could not be loaded.'}</p>
      </div>
    );
  }

  return (
    <div className={styles.page} data-testid="catalogue-product-admin">
      <Link to={BASE} className={styles.backLink} onClick={leave}>← Product catalogue</Link>
      <div>
        <Text as="h1" size="2xl">
          {content.product !== '' ? content.product : 'New product'}
        </Text>
        <Text as="p" tone="muted" size="sm">
          {detail === null ? 'Not saved yet' : `${detail.product.vendor} · ${detail.product.code} · revision ${String(detail.product.edit_revision)}`}
        </Text>
      </div>

      <div className={[styles.actions, styles.stickyActions].filter(Boolean).join(' ')}>
        <button type="button" onClick={save} disabled={busy || !dirty}>Save product</button>
        <button type="button" onClick={validate} disabled={busy}>Validate product</button>
      </div>
      {dirty && <p role="status">Unsaved edits. Save before leaving this product.</p>}
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {notice !== '' && <p role="status">{notice}</p>}

      <div className={styles.fields}>
        <label>Product <input value={content.product} onChange={(event) => { updateProduct({ product: event.target.value }); }} /></label>
        <label>Vendor <input value={content.vendor} onChange={(event) => { updateProduct({ vendor: event.target.value }); }} /></label>
        <label>Stable code <input value={content.code} onChange={(event) => { updateProduct({ code: event.target.value }); }} placeholder="shopify-plus" /></label>
        <label>Summary <textarea value={content.summary} onChange={(event) => { updateProduct({ summary: event.target.value }); }} /></label>
      </div>

      <h2>Capability links ({content.capabilities.length})</h2>
      <p>Link the same product to capabilities in as many sets as it genuinely supports. Each link belongs to one exact capability-set version.</p>
      <div className={styles.linkForm}>
        <label>
          Capability set{' '}
          <select value={linkMapId} onChange={(event) => { loadSetItems(event.target.value); }}>
            <option value="">Choose a set</option>
            {setGroups.map(([groupSector, groupSets]) => (
              <optgroup key={groupSector} label={sectorLabel(groupSector)}>
                {groupSets.map((set) => <option key={set.id} value={set.id}>{setLabel(set)}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          Capability{' '}
          <select value={linkCode} onChange={(event) => { setLinkCode(event.target.value); }} disabled={linkMapId === ''}>
            <option value="">Choose a capability</option>
            {(itemsBySet[linkMapId] ?? []).map((item) => <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}
          </select>
        </label>
        <label>How it supports it <input value={linkHow} onChange={(event) => { setLinkHow(event.target.value); }} placeholder="Runs the online checkout" /></label>
        <button type="button" onClick={addCapabilityLink} disabled={busy || linkMapId === '' || linkCode === '' || linkHow.trim() === ''}>Add link</button>
      </div>
      <div className={styles.cards}>
        {Object.entries(content.capabilities.reduce<Record<string, CatalogueProductContent['capabilities']>>((groups, link) => {
          const group = groups[link.capabilityMapId] ?? [];
          group.push(link);
          groups[link.capabilityMapId] = group;
          return groups;
        }, {})).map(([mapId, links]) => {
          const set = sets.find((candidate) => candidate.id === mapId);
          return (
            <div className={styles.itemCard} key={mapId}>
              <strong>{set ? setLabel(set) : 'Unknown capability set'}</strong>
              {links.map((link) => (
                <div key={link.capabilityCode} className={styles.linkRow}>
                  <span><strong>{link.capabilityName}</strong> <small>{link.capabilityCode}</small><br />{link.howItSupports}</span>
                  <button type="button" onClick={() => { removeCapabilityLink(mapId, link.capabilityCode); }} disabled={busy}>Remove</button>
                </div>
              ))}
            </div>
          );
        })}
        {content.capabilities.length === 0 && <p>No capability links yet. A catalogue entry needs 1-10 links in its pinned set.</p>}
      </div>

      <h2>Claims ({content.claims.length})</h2>
      <p>A claim is dated vendor evidence with an HTTPS source. A catalogue entry needs 1-8 claims, and every claim must be reviewed before the product can be published. Anyone with admin rights can review, including the person who entered the claim. Names and dates are recorded and shown to platform admins only.</p>
      <div className={styles.cards}>
        {content.claims.map((claim, index) => {
          const saved = detail?.content.claims.find((candidate) => sameClaimText(candidate, claim));
          const record = saved === undefined ? undefined : detail?.claimReviews.find((review) => review.position === saved.position);
          const reviewed = record?.reviewState === 'reviewed';
          const changed = saved === undefined && claim.statement.trim() !== '' && (detail?.content.claims.some((candidate) => candidate.position === claim.position) ?? false);
          const notSavedText = changed ? 'Changed since it was saved: it will need review again.' : 'Not saved yet. It is saved as a draft until someone reviews it.';
          return (
            <details className={styles.itemCard} key={index} open={record === undefined}>
              <summary>{claim.statement.trim() === '' ? 'New claim' : claim.statement.slice(0, 70)}{reviewed ? ' · reviewed' : ' · needs review'}</summary>
              <p role="status" data-testid="claim-status">
                {record === undefined ? notSavedText : claimStatusText(record)}
              </p>
              <div className={styles.claimGrid}>
                <label>Position <input type="number" min={1} value={claim.position} onChange={(event) => { updateClaim(index, { position: Number(event.target.value) }); }} /></label>
                <label>Kind <select value={claim.kind} onChange={(event) => { updateClaim(index, { kind: event.target.value as typeof claim.kind }); }}>{CLAIM_KINDS.map((kind) => <option key={kind} value={kind}>{kind.replaceAll('_', ' ')}</option>)}</select></label>
                <label>Source date <input type="date" value={claim.sourceDate} onChange={(event) => { updateClaim(index, { sourceDate: event.target.value }); }} /></label>
                <label>Source URL <input type="url" value={claim.sourceUrl} onChange={(event) => { updateClaim(index, { sourceUrl: event.target.value }); }} /></label>
              </div>
              <label>Statement <textarea value={claim.statement} onChange={(event) => { updateClaim(index, { statement: event.target.value }); }} /></label>
              {!reviewed && (
                <label className={styles.checkLine}>
                  <input type="checkbox" checked={claim.review === true} onChange={(event) => { updateClaim(index, { review: event.target.checked }); }} />{' '}
                  I have checked this claim against its source: mark it reviewed by me when I save
                </label>
              )}
              <button type="button" onClick={() => { updateProduct({ claims: content.claims.filter((_, position) => position !== index) }); }} disabled={busy}>Remove claim</button>
            </details>
          );
        })}
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={addClaim} disabled={busy}>Add claim</button>
      </div>
      {issues && <div className={styles.review} role="status"><h2>Product validation</h2>{issues.length ? <ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : <p>Product details are valid.</p>}</div>}
    </div>
  );
}
