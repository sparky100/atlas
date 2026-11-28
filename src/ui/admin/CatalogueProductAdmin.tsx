import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type {
  CapabilitySetItem,
  CapabilitySetOption,
  CatalogueProductContent,
  GeneralCapabilityOption,
  ClaimCheckRow,
  SourceCheckRow,
} from '../../contracts/catalogueAdmin';
import { claimCheckKey } from '../../contracts/catalogueAdmin';
import {
  listCapabilitySetItems,
  listCapabilitySets,
  listCatalogueProducts,
  listClaimChecks,
  listGeneralCapabilities,
  listSourceChecks,
  publishCatalogueProduct,
  withdrawCatalogueProduct,
  readCatalogueProduct,
  saveCatalogueProduct,
  validateCatalogueProduct,
  type CatalogueProductDetail,
} from '../../db/catalogueAdmin';
import { Loading } from '../components/Loading/Loading';
import { Text } from '../components/Text/Text';
import { useUnsavedChanges } from '../routes/platformAdmin/unsavedChanges';
import { supabase } from '../supabaseClient';
import { CatalogueFindComponents } from './CatalogueFindComponents';
import { claimCheckSentence, claimStatusText, emptyProduct, isGeneralCapabilityCode, publicationStatusText, sameClaimText, sectorLabel, setLabel, sourceCheckSentence } from './catalogueShared';
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
  const [general, setGeneral] = useState<GeneralCapabilityOption[]>([]);
  const [sharedId, setSharedId] = useState('');
  const [sharedHow, setSharedHow] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('');
  /** Products that could be this product's platform: only platforms and stand-alone products, never a component. */
  const [platformChoices, setPlatformChoices] = useState<{ id: string; product: string; vendor: string }[]>([]);
  const [issues, setIssues] = useState<string[] | null>(null);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  /** Latest check of each source link, by address; `null` when they could not be read (then no claim says anything about its link). */
  const [sourceChecks, setSourceChecks] = useState<Map<string, SourceCheckRow> | null>(null);
  /** Latest AI check of each claim, by product, link and exact text; `null` when they could not be read. */
  const [claimChecks, setClaimChecks] = useState<Map<string, ClaimCheckRow> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [nextSets, nextGeneral, nextDetail] = await Promise.all([
          listCapabilitySets(supabase),
          listGeneralCapabilities(supabase),
          productId === null ? Promise.resolve(null) : readCatalogueProduct(supabase, productId),
        ]);
        setSets(nextSets);
        setGeneral(nextGeneral);
        setDetail(nextDetail);
        setContent(nextDetail === null ? emptyProduct() : nextDetail.content);
        // The link checks are extra information: if they cannot be read the editor still works and says nothing about links.
        setSourceChecks(await listSourceChecks(supabase).then((rows) => new Map(rows.map((row) => [row.url, row])), () => null));
        // Naming a platform is extra: if the list cannot be read the editor still works without the choice.
        setPlatformChoices(await listCatalogueProducts(supabase).then((rows) => rows.filter((row) => row.partOfProductId === null && row.id !== productId).map((row) => ({ id: row.id, product: row.product, vendor: row.vendor })), () => []));
        setClaimChecks(await listClaimChecks(supabase).then((rows) => new Map(rows.map((row) => [claimCheckKey(row), row])), () => null));
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
    // A general capability is the same in every sector: link it once, as a shared capability.
    if (isGeneralCapabilityCode(item.code) && general.some((option) => option.code === item.code)) return;
    if (content.capabilities.some((link) => link.capabilityMapId === linkMapId && link.capabilityCode === item.code)) return;
    updateProduct({ capabilities: [...content.capabilities, {
      capabilityMapId: linkMapId, capabilityCode: item.code, capabilityName: item.name, howItSupports: linkHow.trim(),
    }] });
    setLinkCode(''); setLinkHow('');
  };

  const addSharedLink = () => {
    if (content === null || sharedId === '' || sharedHow.trim() === '') return;
    if ((content.generalCapabilities ?? []).some((link) => link.capabilityId === sharedId)) return;
    updateProduct({ generalCapabilities: [...(content.generalCapabilities ?? []), { capabilityId: sharedId, howItSupports: sharedHow.trim() }] });
    setSharedId(''); setSharedHow('');
  };

  const removeSharedLink = (capabilityId: string) => {
    if (content === null) return;
    updateProduct({ generalCapabilities: (content.generalCapabilities ?? []).filter((link) => link.capabilityId !== capabilityId) });
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

  const publish = () => void run(async () => {
    if (detail === null) return;
    const revision = await publishCatalogueProduct(supabase, detail.product.id);
    const next = await readCatalogueProduct(supabase, detail.product.id);
    setDetail(next); setContent(next.content); setIssues(null);
    setNotice(`Published as revision ${String(revision)}, approved by you.`);
  });

  const withdraw = () => void run(async () => {
    if (detail === null || withdrawReason.trim() === '') return;
    await withdrawCatalogueProduct(supabase, detail.product.id, withdrawReason.trim());
    const next = await readCatalogueProduct(supabase, detail.product.id);
    setDetail(next); setContent(next.content); setWithdrawReason('');
    setNotice('Withdrawn from users. The revision stays readable for saved citations.');
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

  const linkCount = content.capabilities.length + (content.generalCapabilities ?? []).length;
  const waiting = detail?.claimReviews.filter((review) => review.reviewState !== 'reviewed').length ?? 0;
  const published = detail?.publication?.withdrawnAt === null;
  const upToDate = published && detail.publication?.unpublishedChanges === false;
  const isPlatform = (detail?.components.length ?? 0) > 0;
  const blocked = detail === null ? ''
    : dirty ? 'Save your changes first.'
    : waiting > 0 ? `${String(waiting)} claim${waiting === 1 ? ' is' : 's are'} waiting for review. Review ${waiting === 1 ? 'it' : 'them'} before publishing.`
    : (detail.claimReviews.length === 0 && !isPlatform) || detail.claimReviews.length > 8 ? 'A published product needs 1 to 8 claims.'
    : linkCount === 0 && detail.components.length === 0 ? 'Add at least one capability link before publishing, or make this the platform of products that have them.'
    : upToDate ? 'This revision is already published.' : '';
  const claimTotal = detail?.claimReviews.length ?? 0;

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

      <div className={styles.statusPanel} data-testid="product-status">
        {detail === null ? <p>Not saved yet. Save the product to see where it stands.</p> : (
          <dl>
            <div><dt>Publication</dt><dd data-testid="status-publication">{publicationStatusText(detail.publication)}</dd></div>
            <div><dt>Claims</dt><dd data-testid="status-claims">{claimTotal === 0 ? (isPlatform ? 'None needed on a platform. Claims sit on its components.' : 'No claims yet') : `${String(claimTotal - waiting)} of ${String(claimTotal)} reviewed${waiting > 0 ? `, ${String(waiting)} waiting for review` : ''}`}</dd></div>
            <div><dt>Capabilities</dt><dd data-testid="status-links">{detail.components.length > 0 ? `A platform with ${String(detail.components.length)} component${detail.components.length === 1 ? '' : 's'}. Capabilities are linked on its components.` : linkCount === 0 ? 'No capability linked yet' : `Linked to ${String(linkCount)} capabilit${linkCount === 1 ? 'y' : 'ies'}`}</dd></div>
            <div><dt>Next</dt><dd data-testid="status-next">{blocked !== '' ? <a href="#publication-section">{blocked}</a> : 'Ready to publish.'}</dd></div>
          </dl>
        )}
      </div>

      <div className={[styles.actions, styles.stickyActions, styles.actionsRow].join(' ')}>
        <button type="button" onClick={save} disabled={busy || !dirty}>Save product</button>
        <button type="button" onClick={validate} disabled={busy}>Check it’s ready</button>
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

      <h2>Platform and components</h2>
      {(detail?.components.length ?? 0) > 0 ? (
        <div data-testid="product-components">
          <p>This product is a platform. Its components are listed below. Link capabilities on the components, not on the platform.</p>
          <ul>
            {detail?.components.map((component) => (
              <li key={component.id}><Link to={`${BASE}/products/${component.id}`}>{component.product}</Link></li>
            ))}
          </ul>
        </div>
      ) : (
        <div className={styles.partOf}>
          <label htmlFor="part-of-select">Part of</label>
          <select id="part-of-select" value={content.partOfProductId ?? ''} onChange={(event) => { updateProduct({ partOfProductId: event.target.value === '' ? null : event.target.value }); }} data-testid="part-of-select">
            <option value="">Not part of another product</option>
            {platformChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.product} ({choice.vendor})</option>)}
          </select>
        </div>
      )}
      {(detail?.components.length ?? 0) === 0 && detail?.partOf != null && content.partOfProductId === detail.partOf.id && (
        <p data-testid="part-of-note">A component of <Link to={`${BASE}/products/${detail.partOf.id}`}>{detail.partOf.product}</Link>.</p>
      )}

      {detail !== null && detail.partOf === null && (
        <CatalogueFindComponents
          platform={{ id: detail.product.id, product: detail.product.product, vendor: detail.product.vendor }}
          disabled={dirty || busy}
          onChanged={() => { void readCatalogueProduct(supabase, detail.product.id).then((next) => { setDetail(next); setContent(next.content); }, () => undefined); }}
        />
      )}

      <h2>Capability links ({content.capabilities.length + (content.generalCapabilities ?? []).length})</h2>
      <p>A shared capability is the same in every sector, so one link covers them all and survives new versions of any set. A sector capability belongs to one sector&apos;s set; it carries over to that sector&apos;s newer versions by its code.</p>

      <h3>Shared capability (every sector)</h3>
      <div className={styles.linkForm}>
        <label>
          Shared capability{' '}
          <select value={sharedId} onChange={(event) => { setSharedId(event.target.value); }} data-testid="shared-capability-select">
            <option value="">Choose a shared capability</option>
            {general.filter((option) => !(content.generalCapabilities ?? []).some((link) => link.capabilityId === option.capabilityId)).map((option) => (
              <option key={option.capabilityId} value={option.capabilityId}>{option.name} ({option.code})</option>
            ))}
          </select>
        </label>
        <label>How it supports it <input value={sharedHow} onChange={(event) => { setSharedHow(event.target.value); }} placeholder="Runs general ledger and reporting" /></label>
        <button type="button" onClick={addSharedLink} disabled={busy || sharedId === '' || sharedHow.trim() === ''}>Add shared link</button>
      </div>
      <div className={styles.cards}>
        {(content.generalCapabilities ?? []).map((link) => {
          const option = general.find((candidate) => candidate.capabilityId === link.capabilityId);
          return (
            <div className={styles.itemCard} key={link.capabilityId} data-testid="shared-link">
              <div className={styles.linkRow}>
                <span><strong>{option?.name ?? 'Shared capability'}</strong> <small>{option?.code ?? ''} · every sector</small><br />{link.howItSupports}</span>
                <button type="button" onClick={() => { removeSharedLink(link.capabilityId); }} disabled={busy}>Remove</button>
              </div>
            </div>
          );
        })}
        {(content.generalCapabilities ?? []).length === 0 && <p>No shared capabilities yet.</p>}
      </div>

      <h3>Sector capability</h3>
      {linkCode !== '' && isGeneralCapabilityCode(linkCode) && general.some((option) => option.code === linkCode) && (
        <p role="status" data-testid="use-shared-hint">This capability is shared by every sector. Link it as a shared capability above instead.</p>
      )}
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
        <button type="button" onClick={addCapabilityLink} disabled={busy || linkMapId === '' || linkCode === '' || linkHow.trim() === '' || (isGeneralCapabilityCode(linkCode) && general.some((option) => option.code === linkCode))}>Add link</button>
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
        {content.capabilities.length === 0 && <p>No sector capability links yet. A catalogue entry needs 1-10 links that apply to its pinned set, counting shared capabilities.</p>}
      </div>

      <h2 id="publication-section">Publication</h2>
      <p data-testid="publication-status">{publicationStatusText(detail?.publication ?? null)}</p>
      {detail !== null && (() => {
        return (
          <>
            {blocked !== '' && <p role="status" data-testid="publish-blocked">{blocked}</p>}
            <div className={styles.actions}>
              <button type="button" onClick={publish} disabled={busy || blocked !== ''}>
                {detail.publication?.withdrawnAt == null ? 'Publish product' : 'Publish new revision'}
              </button>
            </div>
            {published && (
              <div className={styles.linkForm}>
                <label>Reason for withdrawing <input value={withdrawReason} onChange={(event) => { setWithdrawReason(event.target.value); }} placeholder="Vendor sold the product" /></label>
                <button type="button" onClick={withdraw} disabled={busy || dirty || withdrawReason.trim() === ''}>Withdraw from users</button>
              </div>
            )}
          </>
        );
      })()}
      {detail === null && <p>Save the product first. Publishing needs every claim reviewed and at least one capability link.</p>}

      <h2>Claims ({content.claims.length})</h2>
      <p>A claim is dated vendor evidence with an HTTPS source. A catalogue entry needs 1-8 claims (a platform needs none, because its claims sit on its components), and every claim must be reviewed before the product can be published. Anyone with admin rights can review, including the person who entered the claim. Names and dates are recorded and shown to platform admins only.</p>
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
              {sourceChecks !== null && claim.sourceUrl.trim() !== '' && (
                <p data-testid="claim-link-check">
                  {(() => { const check = sourceChecks.get(claim.sourceUrl.trim()); return check === undefined ? 'Link not checked yet.' : `Link: ${sourceCheckSentence(check)}`; })()}
                </p>
              )}
              {claimChecks !== null && detail !== null && claim.statement.trim() !== '' && claim.sourceUrl.trim() !== '' && (
                <p data-testid="claim-ai-check">
                  {claimCheckSentence(claimChecks.get(claimCheckKey({ productId: detail.product.id, sourceUrl: claim.sourceUrl, statement: claim.statement })))}
                </p>
              )}
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
