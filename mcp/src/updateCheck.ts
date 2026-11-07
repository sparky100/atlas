/**
 * ADR-029 open point 4: an optional "is there a newer version" check, off
 * unless the person turns it on. It fetches one small public file and sends
 * nothing about the person or any model. Never throws and never waits long.
 */
export interface VersionFile {
  version: string;
}

export function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function checkForUpdate(opts: { fetchFn: typeof fetch; versionUrl: string; current: string; timeoutMs?: number }): Promise<string | null> {
  try {
    const response = await opts.fetchFn(opts.versionUrl, { signal: AbortSignal.timeout(opts.timeoutMs ?? 2000) });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<VersionFile> | null;
    if (typeof body?.version !== 'string' || !isNewer(body.version, opts.current)) return null;
    return `A newer version of the Atlas connection is available (${body.version}; this is ${opts.current}). Tell the person they can download it from Atlas, Home, "Connect Claude Desktop".`;
  } catch {
    return null;
  }
}
