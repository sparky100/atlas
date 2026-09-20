/**
 * F2 (full K1) PR10, SPEC-capture.md §12.1: loads one fixture directory's
 * `model.json`/`options.json`/`expected.json`/`input.csv|xlsx`/`llm/*.json`
 * into the shapes `runCapture()` and the scorer both need — the harness
 * half of §12, kept separate from `fixtures.test.ts` (the actual Vitest
 * cases) and `scripts/scoreCapture.ts` (the human-readable report over the
 * same numbers) so neither duplicates this loading logic.
 *
 * `model.json`'s own element/relationship "key" strings (never a raw UUID)
 * are what `expected.json`'s own `matchElement` field references (§12.3:
 * "matchElement is a model.json element key") — this module is the one
 * place that mapping is built, and it's returned alongside the folded
 * `Head`/`MatchIndex` so `fixtures.test.ts` can resolve an actual
 * `match.elementId` back to the fixture's own friendly name for a readable
 * assertion failure.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CaptureAliasType } from '../../contracts/capture';
import type { ElementType, RelationshipType, UUID } from '../../contracts/delta';
import { apply, emptyHead, type CommitContext, type Head } from '../../engine/deltas';
import type { RecordedLlmCassette } from '../llm/client';
import { RecordedLlmClient } from '../llm/client';
import { buildMatchIndex, type MatchAliasInput } from '../matchIndex';
import type { PreviousCandidateForDiff } from '../reimportDiff';
import type { ElementsHeadRow } from '../../contracts/rows';

const DEFAULT_SOURCE_ID = 'seed-source-0000-0000-0000-000000000000';
const DEFAULT_AUTHOR_ID = 'seed-author-0000-0000-000000000000';
const DEFAULT_CREATED_AT = '2020-01-01T00:00:00Z';

interface FixtureAttributeOverride {
  attribute: string;
  value: unknown;
  sourceId?: string;
  confidence?: number;
  effectiveDate?: string;
  createdAt?: string;
  authorId?: string;
}

interface FixtureModelElement {
  key: string;
  type: ElementType;
  id: UUID;
  name: string;
  parentKey?: string | null;
  attributes: Record<string, unknown>;
  sourceId?: string;
  confidence?: number;
  effectiveDate?: string;
  createdAt?: string;
  authorId?: string;
  /** Additional `element.update` deltas applied after the create — the only way to give one attribute its own distinct provenance (source/confidence/date) for testing §4.4's conflict-strength rule. */
  overrides?: FixtureAttributeOverride[];
}

interface FixtureModelRelationship {
  key: string;
  type: RelationshipType;
  id: UUID;
  fromKey: string;
  toKey: string;
  attributes: Record<string, unknown>;
  sourceId?: string;
  confidence?: number;
  createdAt?: string;
  authorId?: string;
}

interface FixtureModelAlias {
  elementKey: string;
  type: CaptureAliasType;
  /** The alias text — or, for `merged_id`, the dead element's own id (a plain UUID string, never a fixture "key"). */
  value: string;
}

export interface FixtureModel {
  elements?: FixtureModelElement[];
  relationships?: FixtureModelRelationship[];
  aliases?: FixtureModelAlias[];
}

export interface FixtureOptions {
  inputKind: 'spreadsheet';
  format: 'csv' | 'xlsx';
  documentDate: string | null;
  /** §12.1's own `reimportOf: "<fixture id>"` names another fixture; this harness instead reads a hand-authored `previous.json` sitting alongside this fixture's own files when one is present (§9.2's own "synthetic previous job" — SPEC's own wording for fixture 03), which is simpler than actually re-running a second job to get one. Recorded here only for a human reading `options.json` to see the intent; `loadFixture` itself keys off `previous.json`'s presence, not this field. */
  reimportOf?: string;
}

export interface LoadedFixture {
  id: string;
  dir: string;
  options: FixtureOptions;
  head: Head;
  elementsHead: ElementsHeadRow[];
  matchIndex: ReturnType<typeof buildMatchIndex>;
  keyToId: ReadonlyMap<string, UUID>;
  idToKey: ReadonlyMap<UUID, string>;
  source: { format: 'csv'; text: string } | { format: 'xlsx'; bytes: ArrayBuffer };
  llmClient: RecordedLlmClient;
  /** §9.2 (PR9): present iff `previous.json` exists in the fixture directory — a hand-authored `PreviousCandidateForDiff[]` standing in for "the previous job's own accepted candidates," never derived by actually re-running a second job (SPEC's own "synthetic previous job" wording for fixture 03). */
  reimportPrevious?: PreviousCandidateForDiff[];
  /** Raw, for the scorer/tests to read `expected.json` however they need. */
  expectedRaw: unknown;
}

function deltaCtx(overrides: { createdAt?: string; authorId?: string }): CommitContext {
  return { authorId: overrides.authorId ?? DEFAULT_AUTHOR_ID, createdAt: overrides.createdAt ?? DEFAULT_CREATED_AT };
}

function foldModel(model: FixtureModel): { head: Head; keyToId: Map<string, UUID> } {
  let head = emptyHead();
  const keyToId = new Map<string, UUID>();
  for (const el of model.elements ?? []) keyToId.set(el.key, el.id);
  for (const rel of model.relationships ?? []) keyToId.set(rel.key, rel.id);

  for (const el of model.elements ?? []) {
    const parentId = el.parentKey ? (keyToId.get(el.parentKey) ?? null) : null;
    head = apply(
      head,
      {
        kind: 'element.create',
        id: `create-${el.key}`,
        elementId: el.id,
        elementType: el.type,
        name: el.name,
        parentId,
        attributes: el.attributes,
        sourceId: el.sourceId ?? DEFAULT_SOURCE_ID,
        confidence: el.confidence ?? 1,
        ...(el.effectiveDate !== undefined ? { effectiveDate: el.effectiveDate } : {}),
      } as never,
      deltaCtx(el),
    );

    for (const [i, override] of (el.overrides ?? []).entries()) {
      const fact = head.facts.get(`${el.id}\u0000${override.attribute}`);
      const previousDeltaId = fact?.deltaId ?? head.elements.get(el.id)?.existsDeltaId;
      if (previousDeltaId === undefined) throw new Error(`loadFixture: override for unknown attribute "${override.attribute}" on element "${el.key}".`);
      head = apply(
        head,
        {
          kind: 'element.update',
          id: `override-${el.key}-${String(i)}`,
          elementId: el.id,
          elementType: el.type,
          attribute: override.attribute,
          value: override.value,
          previousDeltaId,
          sourceId: override.sourceId ?? DEFAULT_SOURCE_ID,
          confidence: override.confidence ?? 1,
          ...(override.effectiveDate !== undefined ? { effectiveDate: override.effectiveDate } : {}),
        } as never,
        deltaCtx(override),
      );
    }
  }

  for (const rel of model.relationships ?? []) {
    const fromElementId = keyToId.get(rel.fromKey);
    const toElementId = keyToId.get(rel.toKey);
    if (fromElementId === undefined || toElementId === undefined) throw new Error(`loadFixture: relationship "${rel.key}" references an unknown element key.`);
    head = apply(
      head,
      {
        kind: 'relationship.create',
        id: `create-${rel.key}`,
        relationshipId: rel.id,
        relationshipType: rel.type,
        fromElementId,
        toElementId,
        attributes: rel.attributes,
        sourceId: rel.sourceId ?? DEFAULT_SOURCE_ID,
        confidence: rel.confidence ?? 1,
      } as never,
      deltaCtx(rel),
    );
  }

  return { head, keyToId };
}

function elementsHeadFromHead(head: Head): ElementsHeadRow[] {
  return [...head.elements].map(([element_id, row]) => ({ element_id, element_type: row.elementType, name: row.name, parent_id: row.parentId, attributes: row.attributes, exists_delta_id: row.existsDeltaId }));
}

function aliasInputsFromModel(model: FixtureModel, keyToId: ReadonlyMap<string, UUID>): MatchAliasInput[] {
  return (model.aliases ?? []).map((alias) => {
    const elementId = keyToId.get(alias.elementKey);
    if (elementId === undefined) throw new Error(`loadFixture: alias references unknown element key "${alias.elementKey}".`);
    return { element_id: elementId, alias_value: alias.value, alias_type: alias.type };
  });
}

/** `Buffer.buffer` is the whole underlying allocation, not necessarily just this buffer's own bytes — always slice by `byteOffset`/`byteLength` before handing it to something (SheetJS) that expects a standalone `ArrayBuffer`. */
function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function loadLlmCassettes(llmDir: string): Map<string, RecordedLlmCassette> {
  const cassettes = new Map<string, RecordedLlmCassette>();
  if (!existsSync(llmDir)) return cassettes;
  for (const file of readdirSync(llmDir)) {
    if (!file.endsWith('.json')) continue;
    const hash = file.slice(0, -'.json'.length);
    const cassette = JSON.parse(readFileSync(join(llmDir, file), 'utf-8')) as RecordedLlmCassette;
    cassettes.set(hash, cassette);
  }
  return cassettes;
}

export function loadFixture(fixturesRoot: string, id: string): LoadedFixture {
  const dir = join(fixturesRoot, id);
  const options = JSON.parse(readFileSync(join(dir, 'options.json'), 'utf-8')) as FixtureOptions;
  const modelPath = join(dir, 'model.json');
  const model: FixtureModel = existsSync(modelPath) ? (JSON.parse(readFileSync(modelPath, 'utf-8')) as FixtureModel) : {};
  const expectedRaw: unknown = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf-8'));

  const { head, keyToId } = foldModel(model);
  const elementsHead = elementsHeadFromHead(head);
  const matchIndex = buildMatchIndex(elementsHead, aliasInputsFromModel(model, keyToId));
  const idToKey = new Map<UUID, string>([...keyToId].map(([key, id_]) => [id_, key]));

  const source: LoadedFixture['source'] =
    options.format === 'csv'
      ? { format: 'csv', text: readFileSync(join(dir, 'input.csv'), 'utf-8') }
      : { format: 'xlsx', bytes: bufferToArrayBuffer(readFileSync(join(dir, 'input.xlsx'))) };

  const llmClient = new RecordedLlmClient({ cassettes: loadLlmCassettes(join(dir, 'llm')) });

  const previousPath = join(dir, 'previous.json');
  const reimportPrevious: PreviousCandidateForDiff[] | undefined = existsSync(previousPath) ? (JSON.parse(readFileSync(previousPath, 'utf-8')) as PreviousCandidateForDiff[]) : undefined;

  return { id, dir, options, head, elementsHead, matchIndex, keyToId, idToKey, source, llmClient, ...(reimportPrevious !== undefined ? { reimportPrevious } : {}), expectedRaw };
}
