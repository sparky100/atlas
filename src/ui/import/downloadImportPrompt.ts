/**
 * Import close-out — "Download AI import prompt": `docs/import/PROMPT.md`,
 * rendered with this model's own capability list and the real import
 * schema substituted in, so pasting it into an AI assistant produces a
 * file that actually imports cleanly (never a stale, hand-copied schema,
 * and never a capability name the model doesn't have).
 *
 * The template itself is bundled into the app via Vite's `?raw` import —
 * one canonical copy in `docs/`, not a second one duplicated into `src/`.
 * Rendering is plain substitution (`{{SCHEMA}}`/`{{CAPABILITY_LIST}}`), no
 * templating engine: the markers are simple enough that one wouldn't earn
 * its own dependency.
 */
import promptTemplate from '../../../docs/import/PROMPT.md?raw';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { getMainBranch } from '../../db/branches';
import { listCapabilitiesForMap } from '../../db/capabilityMap';
import type { Client } from '../../db/client';
import { buildImportPromptSchema } from '../../capture/importPromptSchema';
import { capabilityLevel } from '../elements/capabilityDepth';

/** Level-1 capabilities, each followed by its own level-2 children, both sorted by name — level 3 and anything with a broken chain are left out (this prompt is a rough map for someone writing free text, not the full tree). */
function buildCapabilityListMarkdown(capabilities: readonly ElementsHeadRow[]): string {
  const byId = new Map(capabilities.map((c) => [c.element_id, c]));
  const levelOf = (c: ElementsHeadRow): number | null => {
    const parent = c.parent_id !== null ? (byId.get(c.parent_id) ?? null) : null;
    const grandparent = parent?.parent_id !== null && parent?.parent_id !== undefined ? (byId.get(parent.parent_id) ?? null) : null;
    return capabilityLevel(parent, grandparent);
  };

  const level1 = capabilities.filter((c) => levelOf(c) === 1).sort((a, b) => a.name.localeCompare(b.name));
  if (level1.length === 0) return '_(This model has no capabilities yet — leave every `capability` column blank.)_';

  const level2ByParentId = new Map<UUID, ElementsHeadRow[]>();
  for (const c of capabilities) {
    if (levelOf(c) !== 2 || c.parent_id === null) continue;
    const siblings = level2ByParentId.get(c.parent_id) ?? [];
    siblings.push(c);
    level2ByParentId.set(c.parent_id, siblings);
  }

  const lines: string[] = [];
  for (const l1 of level1) {
    lines.push(`- ${l1.name}`);
    const children = (level2ByParentId.get(l1.element_id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    for (const l2 of children) lines.push(`  - ${l2.name}`);
  }
  return lines.join('\n');
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Pure — `docs/import/PROMPT.md`'s own two markers, substituted; no Supabase, no DOM. Extracted from `downloadImportPrompt` below so the actual served content (not just `buildImportPromptSchema`'s own `{{SCHEMA}}` fragment) has something to test against. */
export function renderImportPrompt(capabilities: readonly ElementsHeadRow[]): string {
  return promptTemplate.replace('{{SCHEMA}}', buildImportPromptSchema()).replace('{{CAPABILITY_LIST}}', buildCapabilityListMarkdown(capabilities));
}

/** Loads this model's own current capability tree, renders the prompt, and triggers the download — `atlas-import-prompt-<model-slug>.md`. A model with no commits yet (no main) renders with an empty capability list rather than failing; there's nothing to name yet either way. */
export async function downloadImportPrompt(supabase: Client, modelId: UUID, modelSlug: string): Promise<void> {
  const main = await getMainBranch(supabase, modelId);
  const capabilities = main ? await listCapabilitiesForMap(supabase, main.head_commit_id) : [];
  downloadBlob(new Blob([renderImportPrompt(capabilities)], { type: 'text/markdown' }), `atlas-import-prompt-${modelSlug}.md`);
}
