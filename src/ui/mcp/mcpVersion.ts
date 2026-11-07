/**
 * ADR-029 §3: reads the small version file the build publishes beside the
 * Claude Desktop download. Anything that is not that file (a missing file
 * answered with the app's own page, a network error) means "no download
 * here", so the card stays hidden rather than offering a dead link.
 */
export interface McpDownload {
  version: string;
  extensionUrl: string;
}

export const MCP_VERSION_URL = '/downloads/mcp-version.json';

export function parseMcpVersion(body: unknown): McpDownload | null {
  if (typeof body !== 'object' || body === null) return null;
  const r = body as { version?: unknown; downloads?: { extension?: unknown } };
  const file = r.downloads?.extension;
  if (typeof r.version !== 'string' || r.version === '' || typeof file !== 'string' || !/^[\w.-]+\.mcpb$/.test(file)) return null;
  return { version: r.version, extensionUrl: `/downloads/${file}` };
}

export async function fetchMcpDownload(fetchFn: typeof fetch = fetch): Promise<McpDownload | null> {
  try {
    const response = await fetchFn(MCP_VERSION_URL, { cache: 'no-cache' });
    if (!response.ok) return null;
    return parseMcpVersion(await response.json());
  } catch {
    return null;
  }
}
