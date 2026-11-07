/**
 * ADR-029 §3: builds the downloadable Atlas connection for Claude Desktop.
 *
 *   mcp/src/main.ts  ->  public/downloads/atlas-mcp.mjs   (runs with plain `node`)
 *                        public/downloads/atlas.mcpb      (the extension: manifest + that file)
 *                        public/downloads/mcp-version.json
 *
 * Runs in `prebuild`, so every deploy serves a bundle built from the same
 * commit as the app. The outputs are build output, git-ignored. The public
 * Supabase URL and anon key (the two values every browser already receives)
 * are baked in from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (or
 * SUPABASE_URL / SUPABASE_ANON_KEY); no secret ever reaches this file.
 */
import { execSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { ATLAS_MODEL_TOOLS } from '../mcp/src/atlasTools';
import { SERVER_VERSION } from '../mcp/src/version';
import { zipFiles } from './zipFiles';

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const OUT_DIR = root('public/downloads');

function buildSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    const fallback = process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA;
    return fallback ? fallback.slice(0, 7) : 'unknown';
  }
}

const firstSentence = (text: string): string => (/^(.+?\.)(\s|$)/.exec(text)?.[1] ?? text).slice(0, 200);

export interface ManifestInput {
  template: Record<string, unknown>;
  version: string;
  tools: readonly { name: string; description: string }[];
}

/** The manifest the extension ships with: the template plus the version and the tool list read from the code, so neither drifts. */
export function buildManifest(input: ManifestInput): Record<string, unknown> {
  return {
    ...input.template,
    version: input.version,
    tools: [
      { name: 'atlas_list_models', description: 'List the Atlas models you can see.' },
      { name: 'atlas_get_guide', description: 'How Atlas is organised and which tool answers which kind of question.' },
      ...input.tools.map((t) => ({ name: t.name, description: firstSentence(t.description) })),
    ],
  };
}

async function main(): Promise<void> {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
  const appUrl = process.env.ATLAS_APP_URL ?? '';
  if (url === '' || anonKey === '') {
    console.warn('bundleMcp: no Supabase URL / anon key in the environment, so the download will not know which Atlas to connect to. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before building.');
  }
  const sha = buildSha();

  const result = await build({
    entryPoints: [root('mcp/src/main.ts')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    define: {
      __ATLAS_URL__: JSON.stringify(url),
      __ATLAS_ANON_KEY__: JSON.stringify(anonKey),
      __ATLAS_APP_URL__: JSON.stringify(appUrl),
    },
    // Some of the SDK's dependencies are CommonJS and call require().
    banner: { js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" },
    legalComments: 'none',
    logLevel: 'warning',
  });
  const server = Buffer.from(result.outputFiles[0]?.contents ?? new Uint8Array());
  if (server.length === 0) throw new Error('bundleMcp: esbuild produced no output');

  const template = JSON.parse(readFileSync(root('mcp/bundle/manifest.json'), 'utf8')) as Record<string, unknown>;
  const manifest = buildManifest({ template, version: SERVER_VERSION, tools: ATLAS_MODEL_TOOLS });

  mkdirSync(OUT_DIR, { recursive: true });
  const serverFile = path.join(OUT_DIR, 'atlas-mcp.mjs');
  writeFileSync(serverFile, server);
  chmodSync(serverFile, 0o755);
  writeFileSync(
    path.join(OUT_DIR, 'atlas.mcpb'),
    zipFiles([
      { name: 'manifest.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
      { name: 'server/atlas-mcp.mjs', data: server },
    ]),
  );
  writeFileSync(
    path.join(OUT_DIR, 'mcp-version.json'),
    `${JSON.stringify({ version: SERVER_VERSION, build: sha, published: new Date().toISOString(), downloads: { extension: 'atlas.mcpb', server: 'atlas-mcp.mjs' } }, null, 2)}\n`,
  );
  console.log(`Published Atlas MCP ${SERVER_VERSION} (${sha}) to ${OUT_DIR}`);
}

// Only run when invoked as a script, so a test can import `buildManifest`.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
