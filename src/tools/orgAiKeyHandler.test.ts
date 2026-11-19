import { describe, expect, it } from 'vitest';
import { handleOrgAiKey, type OrgAiKeyDeps } from './orgAiKeyHandler';

const ORG = '11111111-1111-4111-8111-111111111111';

function deps(owner: boolean): OrgAiKeyDeps & { saved: string[]; cleared: string[] } {
  const saved: string[] = [];
  const cleared: string[] = [];
  return {
    saved,
    cleared,
    isOwner: () => Promise.resolve(owner),
    setKey: (_org, key) => {
      saved.push(key);
      return Promise.resolve();
    },
    clearKey: (org) => {
      cleared.push(org);
      return Promise.resolve();
    },
  };
}

describe('handleOrgAiKey', () => {
  it('saves a trimmed key for an owner and never returns it', async () => {
    const d = deps(true);
    const out = await handleOrgAiKey(d, { orgId: ORG, action: 'set', key: '  sk-secret-123  ' });
    expect(out).toEqual({ status: 'saved' });
    expect(d.saved).toEqual(['sk-secret-123']);
    expect(JSON.stringify(out)).not.toContain('sk-secret');
  });

  it('clears the key for an owner', async () => {
    const d = deps(true);
    expect(await handleOrgAiKey(d, { orgId: ORG, action: 'clear' })).toEqual({ status: 'cleared' });
    expect(d.cleared).toEqual([ORG]);
  });

  it('refuses anyone who is not an owner, without touching the key, and does not echo it', async () => {
    const d = deps(false);
    const out = await handleOrgAiKey(d, { orgId: ORG, action: 'set', key: 'sk-secret-123' });
    expect(out.status).toBe('forbidden');
    expect(JSON.stringify(out)).not.toContain('sk-secret');
    expect(d.saved).toEqual([]);
    expect((await handleOrgAiKey(d, { orgId: ORG, action: 'clear' })).status).toBe('forbidden');
    expect(d.cleared).toEqual([]);
  });

  it('rejects bad requests before any check', async () => {
    const d = deps(true);
    expect((await handleOrgAiKey(d, null)).status).toBe('invalid');
    expect((await handleOrgAiKey(d, { orgId: 'nope', action: 'set', key: 'k' })).status).toBe('invalid');
    expect((await handleOrgAiKey(d, { orgId: ORG, action: 'delete' })).status).toBe('invalid');
    expect((await handleOrgAiKey(d, { orgId: ORG, action: 'set', key: '   ' })).status).toBe('invalid');
    expect((await handleOrgAiKey(d, { orgId: ORG, action: 'set', key: 'x'.repeat(513) })).status).toBe('invalid');
    expect(d.saved).toEqual([]);
  });
});
