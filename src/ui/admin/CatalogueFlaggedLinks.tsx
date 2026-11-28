import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { claimCheckVerdictLabel, sourceCheckLabel, type SourceCheckResult } from '../../contracts/catalogueAdmin';
import { checkClaims, keepSourceLink, recheckSourceLink, replaceClaimSource, saveClaimChecks, type FlaggedSourceLink, unkeepSourceLink } from '../../db/catalogueAdmin';
import { CLAIM_CHECK_MAX_CLAIMS } from '../../tools/catalogueClaimCheck';
import { isKept, KEEP_FOR_NOW_DAYS, KEEP_OLD_ADDRESS_DAYS, movedLinkIsSameSite } from '../../tools/catalogueResultActions';
import { supabase } from '../supabaseClient';
import { formatDay } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';
import { errorText } from './adminErrorText';

const GROUPS: { result: Exclude<SourceCheckResult, 'works'>; title: string }[] = [
  { result: 'moved', title: 'Moved' },
  { result: 'gone', title: 'Gone' },
  { result: 'could_not_check', title: 'Could not check' },
];

function usedBy(item: FlaggedSourceLink): { productId: string; productName: string; vendor: string; claims: number }[] {
  const byProduct = new Map<string, { productId: string; productName: string; vendor: string; claims: number }>();
  for (const claim of item.claims) {
    const row = byProduct.get(claim.productId) ?? { productId: claim.productId, productName: claim.productName, vendor: claim.vendor, claims: 0 };
    row.claims += 1;
    byProduct.set(claim.productId, row);
  }
  return [...byProduct.values()];
}

/**
 * The links that are not working, grouped by problem and closed until opened,
 * one short row each, with what a person can do about each: use the new
 * address, keep the old one for a while, check the claims against the page, or
 * replace the address. Every change goes through the guarded product save or a
 * record the server stamps with who and when.
 */
export function CatalogueFlaggedLinks({ flagged, onChanged, onClaimsChecked }: {
  flagged: FlaggedSourceLink[];
  onChanged: () => Promise<void>;
  onClaimsChecked?: (() => void) | undefined;
}) {
  const [query, setQuery] = useState('');
  const [showKept, setShowKept] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [replacing, setReplacing] = useState<string | null>(null);
  const [replacement, setReplacement] = useState('');
  const now = new Date();

  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return flagged.filter((item) => needle === ''
      || item.check.url.toLowerCase().includes(needle)
      || (item.check.finalUrl ?? '').toLowerCase().includes(needle)
      || item.claims.some((claim) => `${claim.productName} ${claim.vendor}`.toLowerCase().includes(needle)));
  }, [flagged, query]);

  const keptCount = flagged.filter((item) => isKept(item.check.hiddenUntil, now)).length;
  const counts = GROUPS.map((group) => ({ ...group, count: flagged.filter((item) => item.check.result === group.result && !isKept(item.check.hiddenUntil, now)).length }));

  const act = async (key: string, work: () => Promise<string>) => {
    setBusy(key); setError(''); setNotice('');
    try {
      setNotice(await work());
      await onChanged();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  const applyNewAddress = (items: FlaggedSourceLink[]) => act(`use-${items[0]?.check.url ?? ''}`, async () => {
    const names = new Set<string>();
    const failures: string[] = [];
    for (const item of items) {
      if (item.check.finalUrl === null) continue;
      const result = await replaceClaimSource(supabase, item.check.url, item.check.finalUrl, usedBy(item));
      result.changed.forEach((name) => names.add(name));
      result.failed.forEach((failure) => failures.push(`${failure.product}: ${failure.message}`));
    }
    const done = `Pointed ${String(names.size)} product${names.size === 1 ? '' : 's'} at the new address${items.length === 1 ? '' : `es (${String(items.length)} links)`}. The edit is recorded with your name. A published product shows "published, with changes" until you publish it again, and the claims need reviewing again.`;
    return failures.length === 0 ? done : `${done} Not changed: ${failures.join('; ')}`;
  });

  const keep = (item: FlaggedSourceLink, days: number, reason: string) => act(`keep-${item.check.url}`, async () => {
    await keepSourceLink(supabase, item.check.url, days, reason);
    return `Kept for ${String(days)} days, recorded with your name. It comes back to the list after that, or sooner if the next check finds something different.`;
  });

  const checkAgain = (item: FlaggedSourceLink) => act(`again-${item.check.url}`, async () => {
    const result = await recheckSourceLink(supabase, item.check.url);
    return result === undefined ? 'No answer came back.' : `Checked again: ${sourceCheckLabel(result.result).toLowerCase()}.`;
  });

  const checkClaimsAgainstLink = (item: FlaggedSourceLink) => act(`claims-${item.check.url}`, async () => {
    const claims = item.claims.slice(0, CLAIM_CHECK_MAX_CLAIMS).map((claim) => ({ productId: claim.productId, product: claim.productName, vendor: claim.vendor, sourceUrl: item.check.url, statement: claim.statement }));
    const results = await checkClaims(supabase, claims);
    await saveClaimChecks(supabase, results);
    onClaimsChecked?.();
    const text = results.map((result) => claimCheckVerdictLabel(result.verdict).toLowerCase()).join(', ');
    return `Asked the AI to check ${String(results.length)} claim${results.length === 1 ? '' : 's'} against this link: ${text}.${item.claims.length > claims.length ? ` ${String(item.claims.length - claims.length)} more are not checked yet.` : ''} See Claims below.`;
  });

  const replaceAddress = (item: FlaggedSourceLink) => act(`replace-${item.check.url}`, async () => {
    const address = replacement.trim();
    let parsed: URL;
    try { parsed = new URL(address); } catch { throw new Error('Paste a full web address that starts with https://.'); }
    if (parsed.protocol !== 'https:') throw new Error('Use an address that starts with https://.');
    const checked = await recheckSourceLink(supabase, address);
    if (checked === undefined || checked.result === 'gone' || checked.result === 'could_not_check') {
      throw new Error('That address did not work when checked, so nothing was changed.');
    }
    const result = await replaceClaimSource(supabase, item.check.url, address, usedBy(item));
    setReplacing(null); setReplacement('');
    return `Pointed ${String(result.changed.length)} product${result.changed.length === 1 ? '' : 's'} at the new address, recorded with your name.${result.failed.length > 0 ? ` Not changed: ${result.failed.map((failure) => `${failure.product}: ${failure.message}`).join('; ')}` : ''}`;
  });

  return (
    <div data-testid="source-links-flagged">
      <p data-testid="source-links-counts">
        {counts.filter((group) => group.count > 0).map((group) => `${group.title} ${String(group.count)}`).join(', ') || 'Nothing is waiting.'}
        {keptCount > 0 ? `. ${String(keptCount)} kept for now.` : ''}
      </p>
      <div className={styles.controls}>
        <label>Search links, products or vendors
          <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); }} />
        </label>
        {keptCount > 0 && (
          <label className={styles.checkLine}>
            <input type="checkbox" checked={showKept} onChange={(event) => { setShowKept(event.target.checked); }} /> Show kept links
          </label>
        )}
      </div>
      {notice !== '' && <p role="status">{notice}</p>}
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {GROUPS.map((group) => {
        const items = matching.filter((item) => item.check.result === group.result && (showKept || !isKept(item.check.hiddenUntil, now)));
        if (items.length === 0) return null;
        const safe = group.result === 'moved' ? items.filter((item) => !isKept(item.check.hiddenUntil, now) && movedLinkIsSameSite(item.check.url, item.check.finalUrl)) : [];
        return (
          <details key={`${group.result}-${query === '' ? 'closed' : 'open'}`} className={styles.group} open={query !== ''} data-testid={`source-links-group-${group.result}`}>
            <summary>{group.title} ({String(items.length)})</summary>
            <div className={styles.groupBody}>
              {safe.length > 0 && (
                <div className={styles.rowActions}>
                  <button type="button" disabled={busy !== null} onClick={() => { void applyNewAddress(safe); }}>
                    Use the new address for the {String(safe.length)} that stay on the same site
                  </button>
                </div>
              )}
              {items.map((item) => {
                const kept = isKept(item.check.hiddenUntil, now);
                const products = usedBy(item);
                return (
                  <div key={item.check.url} className={styles.resultRow} data-testid="source-link-row">
                    <p><a href={item.check.url} target="_blank" rel="noopener noreferrer">{item.check.url}</a></p>
                    {group.result === 'moved' && item.check.finalUrl !== null && (
                      <small>Now leads to <a href={item.check.finalUrl} target="_blank" rel="noopener noreferrer">{item.check.finalUrl}</a>{movedLinkIsSameSite(item.check.url, item.check.finalUrl) ? ' (same site)' : ' (a different page, so look before using it)'}</small>
                    )}
                    {group.result !== 'moved' && <small>{item.check.note ?? (item.check.httpStatus === null ? 'No answer.' : `The site answered ${String(item.check.httpStatus)}.`)}</small>}
                    <small>
                      Checked {formatDay(item.check.checkedAt)}{item.check.checkedByName === null ? '' : ` by ${item.check.checkedByName}`}. Used by{' '}
                      {products.map((product, index) => (
                        <span key={product.productId}>{index > 0 ? ', ' : ''}<Link to={`/platform-admin/catalogue/products/${product.productId}`}>{product.productName}</Link> ({product.vendor}, {String(product.claims)} claim{product.claims === 1 ? '' : 's'})</span>
                      ))}.
                    </small>
                    <details>
                      <summary><small>What the {String(item.claims.length)} claim{item.claims.length === 1 ? '' : 's'} say{item.claims.length === 1 ? 's' : ''}</small></summary>
                      {item.claims.map((claim) => <small key={`${claim.productId}-${String(claim.position)}`} style={{ display: 'block' }}>{claim.productName}: {claim.statement}</small>)}
                    </details>
                    {kept && <small>Kept until {formatDay(item.check.hiddenUntil ?? '')}{item.check.hiddenByName === null ? '' : ` by ${item.check.hiddenByName}`}{item.check.hiddenReason === null ? '' : `: ${item.check.hiddenReason}`}.</small>}
                    <div className={styles.rowActions}>
                      {kept ? (
                        <button type="button" disabled={busy !== null} onClick={() => { void act(`back-${item.check.url}`, async () => { await unkeepSourceLink(supabase, item.check.url); return 'Brought back into the list.'; }); }}>Bring back</button>
                      ) : (
                        <>
                          {group.result === 'moved' && item.check.finalUrl !== null && (
                            <>
                              <button type="button" disabled={busy !== null} onClick={() => { void applyNewAddress([item]); }}>Use the new address</button>
                              <button type="button" disabled={busy !== null} onClick={() => { void keep(item, KEEP_OLD_ADDRESS_DAYS, 'The old address is still the right page.'); }}>Keep the old address</button>
                              <button type="button" disabled={busy !== null} onClick={() => { void checkClaimsAgainstLink(item); }}>Check the claims against it</button>
                            </>
                          )}
                          {group.result !== 'moved' && (
                            <>
                              <button type="button" disabled={busy !== null} onClick={() => { void checkAgain(item); }}>Check again</button>
                              {group.result === 'gone' && <button type="button" disabled={busy !== null} onClick={() => { setReplacing(replacing === item.check.url ? null : item.check.url); setReplacement(''); }}>Replace the address</button>}
                              <button type="button" disabled={busy !== null} onClick={() => { void keep(item, KEEP_FOR_NOW_DAYS, group.result === 'gone' ? 'Looked at it; leaving it for now.' : 'Could not be checked; leaving it for now.'); }}>Keep for now</button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                    {replacing === item.check.url && (
                      <div className={styles.replaceForm}>
                        <label>New address
                          <input type="url" value={replacement} onChange={(event) => { setReplacement(event.target.value); }} placeholder="https://" />
                        </label>
                        <button type="button" disabled={busy !== null || replacement.trim() === ''} onClick={() => { void replaceAddress(item); }}>Check it and use it</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
