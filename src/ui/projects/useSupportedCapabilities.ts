import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { UUID } from '../../contracts/delta';
import { getElementsByIds } from '../../db/elements';
import { listSupportsEdgesForSystems } from '../../db/landscape';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import type { ProjectScopeItem } from './projectModel';
import { capabilityIdsSupportedBy, supportedCapabilitiesNotice } from './supportedCapabilities';

/**
 * A project can't stand apart from a capability, and a system that supports
 * one already tells us which (Simon, 2026-11-19). When a system is in the
 * project's scope (from a finding, or picked), fill in the capabilities it
 * supports, once per system, so a removal the person makes sticks. Returns one
 * sentence per system saying what was added, or that no link is recorded.
 */
export function useSupportedCapabilities(commitId: UUID | null, scope: readonly ProjectScopeItem[], setScope: Dispatch<SetStateAction<ProjectScopeItem[]>>): string[] {
  const resolved = useRef(new Set<UUID>());
  const [notices, setNotices] = useState<Record<string, string>>({});
  const systemKey = scope.filter((s) => s.elementType === 'system').map((s) => s.elementId).join(',');

  useEffect(() => {
    if (commitId === null || systemKey === '') return;
    for (const id of systemKey.split(',')) {
      if (resolved.current.has(id)) continue;
      resolved.current.add(id);
      const name = scope.find((s) => s.elementId === id)?.name ?? 'This system';
      void (async () => {
        try {
          const capabilityIds = capabilityIdsSupportedBy(await listSupportsEdgesForSystems(supabase, commitId, [id]), id).slice(0, 20);
          const heads = await getElementsByIds(supabase, commitId, capabilityIds);
          const capabilities = capabilityIds.flatMap((cid) => {
            const head = heads.get(cid);
            return head?.element_type === 'capability' ? [{ elementId: cid, name: head.name, elementType: 'capability' as const }] : [];
          });
          setScope((prev) => [...prev, ...capabilities.filter((c) => !prev.some((p) => p.elementId === c.elementId))]);
          setNotices((prev) => ({ ...prev, [id]: supportedCapabilitiesNotice(name, capabilities.map((c) => c.name)) }));
        } catch (e) {
          // Filling in is a help, not a requirement: the person can still name a capability themselves.
          reportError('Could not look up the capabilities this system supports.', e);
        }
      })();
    }
    // `scope` is read only for a name at the moment a system first appears; the systems themselves are the dependency.
  }, [commitId, systemKey, setScope]);

  return Object.entries(notices).flatMap(([id, text]) => (systemKey.split(',').includes(id) ? [text] : []));
}
