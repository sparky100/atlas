/**
 * Unit tests for src/engine/mergeResolution.ts's buildFieldConflictResolutions.
 */
import { describe, expect, it } from 'vitest';
import type { Delta, UUID } from '../contracts/delta';
import { diffFacts } from './branch';
import { emptyHead, fold, type CommitContext, type Head } from './deltas';
import { buildFieldConflictResolutions, unresolvedFieldConflictKeys, type FieldConflictChoice } from './mergeResolution';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };

function createEl(id: UUID, elementId: UUID, name: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 'src', confidence: 1 };
}

function updateAttr(id: UUID, elementId: UUID, attribute: string, value: unknown, previousDeltaId: UUID): Delta {
  return { kind: 'element.update', id, elementId, elementType: 'system', attribute: attribute as never, value: value as never, previousDeltaId, sourceId: 'src', confidence: 1 };
}

function scenario() {
  const base: Head = fold(emptyHead(), [createEl('d0', 'el', 'X')], ctx);
  const ours: Head = fold(fold(emptyHead(), [createEl('d0', 'el', 'X')], ctx), [updateAttr('d-ours', 'el', 'name', 'Renamed by ours', 'd0')], ctx);
  const theirs: Head = fold(fold(emptyHead(), [createEl('d0', 'el', 'X')], ctx), [updateAttr('d-theirs', 'el', 'name', 'Renamed by theirs', 'd0')], ctx);
  return { base, ours, theirs, fields: diffFacts(base, ours, theirs) };
}

function idMinter(ids: UUID[]): () => UUID {
  let i = 0;
  return () => {
    const id = ids[i];
    i += 1;
    if (id === undefined) throw new Error('idMinter: ran out of ids');
    return id;
  };
}

describe('buildFieldConflictResolutions', () => {
  it('keep-ours: value is ours\', winning is ours\' own delta, discarded is theirs\'', () => {
    const { ours, fields } = scenario();
    const choices: FieldConflictChoice[] = [{ subjectId: 'el', attribute: 'name', action: 'keep-ours' }];
    const result = buildFieldConflictResolutions(fields, ours, choices, 'merge-resolution-source', idMinter(['d-resolution']));

    expect(result.deltas).toEqual([expect.objectContaining({ kind: 'element.update', id: 'd-resolution', attribute: 'name', value: 'Renamed by ours', previousDeltaId: 'd-ours', sourceId: 'merge-resolution-source', confidence: 1 })]);
    expect(result.resolvedConflicts).toEqual([{ winningDeltaId: 'd-ours', discardedDeltaId: 'd-theirs', resolutionDeltaId: 'd-resolution' }]);
  });

  it('keep-theirs: value is theirs\', winning is theirs\' own delta, discarded is ours\'', () => {
    const { ours, fields } = scenario();
    const choices: FieldConflictChoice[] = [{ subjectId: 'el', attribute: 'name', action: 'keep-theirs' }];
    const result = buildFieldConflictResolutions(fields, ours, choices, 'merge-resolution-source', idMinter(['d-resolution']));

    expect(result.deltas).toEqual([expect.objectContaining({ value: 'Renamed by theirs', previousDeltaId: 'd-ours' })]);
    expect(result.resolvedConflicts).toEqual([{ winningDeltaId: 'd-theirs', discardedDeltaId: 'd-ours', resolutionDeltaId: 'd-resolution' }]);
  });

  it('value: a typed-in value wins outright, discarded is ours\' own superseded delta', () => {
    const { ours, fields } = scenario();
    const choices: FieldConflictChoice[] = [{ subjectId: 'el', attribute: 'name', action: 'value', value: 'A Third Name' }];
    const result = buildFieldConflictResolutions(fields, ours, choices, 'merge-resolution-source', idMinter(['d-resolution']));

    expect(result.deltas).toEqual([expect.objectContaining({ value: 'A Third Name', previousDeltaId: 'd-ours' })]);
    expect(result.resolvedConflicts).toEqual([{ winningDeltaId: 'd-resolution', discardedDeltaId: 'd-ours', resolutionDeltaId: 'd-resolution' }]);
  });

  it('throws for a choice that no longer matches an actual field-conflict', () => {
    const { ours, fields } = scenario();
    const choices: FieldConflictChoice[] = [{ subjectId: 'el', attribute: 'vendor', action: 'keep-ours' }];
    expect(() => buildFieldConflictResolutions(fields, ours, choices, 'src', idMinter(['x']))).toThrow(/no field-conflict/);
  });

  it('throws when action is "value" but no value was supplied', () => {
    const { ours, fields } = scenario();
    const choices: FieldConflictChoice[] = [{ subjectId: 'el', attribute: 'name', action: 'value' }];
    expect(() => buildFieldConflictResolutions(fields, ours, choices, 'src', idMinter(['x']))).toThrow(/no value was supplied/);
  });
});

describe('unresolvedFieldConflictKeys (SPEC §7.5 C15)', () => {
  it('lists every FIELD_CONFLICT key with no matching choice', () => {
    const { fields } = scenario();
    expect(unresolvedFieldConflictKeys(fields, [])).toEqual([{ subjectId: 'el', attribute: 'name' }]);
  });

  it('is empty once every FIELD_CONFLICT key has a choice', () => {
    const { fields } = scenario();
    expect(unresolvedFieldConflictKeys(fields, [{ subjectId: 'el', attribute: 'name', action: 'keep-ours' }])).toEqual([]);
  });

  it('ignores a choice for a key that is not actually FIELD_CONFLICT', () => {
    const { fields } = scenario();
    expect(unresolvedFieldConflictKeys(fields, [{ subjectId: 'el', attribute: 'vendor', action: 'keep-ours' }])).toEqual([{ subjectId: 'el', attribute: 'name' }]);
  });
});
