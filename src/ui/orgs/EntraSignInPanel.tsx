import { useCallback, useEffect, useId, useState } from 'react';
import { normaliseTenantId } from '../../contracts/entraTenant';
import type { OrgEntraTenantRow } from '../../contracts/entraTenant';
import type { UUID } from '../../contracts/delta';
import { clearEntraTenant, getEntraTenant, setEntraTenant } from '../../db/entraTenants';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import styles from './OrganisationSettingsView.module.css';

/**
 * Owner-only "Microsoft sign-in" settings: the one place an owner records
 * their company's Microsoft tenant ID. Omitted entirely for a non-owner, the
 * same convention this page's other owner-only panels use.
 */
export function EntraSignInPanel({ orgId }: { orgId: UUID }) {
  const inputId = useId();
  const [tenant, setTenant] = useState<OrgEntraTenantRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEntraTenant(supabase, orgId)
      .then((row) => {
        if (!cancelled) {
          setTenant(row);
          setValue(row?.tenant_id ?? '');
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) reportError('Could not load Microsoft sign-in.', e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const save = useCallback(async () => {
    const tenantId = normaliseTenantId(value);
    if (tenantId === null) {
      setMessage("That doesn't look like a Microsoft tenant ID. It is 32 letters and numbers in the form 11111111-2222-3333-4444-555555555555.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      setTenant(await setEntraTenant(supabase, orgId, tenantId));
      setValue(tenantId);
      setMessage('Saved. People who sign in with a Microsoft account from this tenant now join as Viewers.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save Microsoft sign-in.');
    } finally {
      setSaving(false);
    }
  }, [orgId, value]);

  const remove = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      await clearEntraTenant(supabase, orgId);
      setTenant(null);
      setValue('');
      setMessage('Removed. Nobody new can join by Microsoft sign-in. Existing members keep their access until you remove them.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not remove Microsoft sign-in.');
    } finally {
      setSaving(false);
    }
  }, [orgId]);

  return (
    <>
      <Text as="p" tone="muted" size="sm">
        Let your people sign in with their work Microsoft account. Enter your company's Microsoft tenant ID (in the Azure portal: Microsoft Entra ID, then Overview, then Tenant ID). Anyone who signs in from that tenant joins this organisation as a Viewer; you can change their role afterwards. Your IT administrator needs to approve Atlas once for your company.
      </Text>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor={inputId}>
          <Text as="span" size="sm">
            Microsoft tenant ID
          </Text>
        </label>
        <input
          id={inputId}
          className={styles.input}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={loading || saving}
          onChange={(e) => {
            setValue(e.target.value);
          }}
        />
        <Button variant="primary" type="submit" disabled={loading || saving || value.trim() === ''}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {tenant !== null && (
          <Button
            variant="secondary"
            type="button"
            disabled={saving}
            onClick={() => {
              void remove();
            }}
          >
            Remove
          </Button>
        )}
      </form>
      {message !== null && <Text as="p">{message}</Text>}
    </>
  );
}
