import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { CapabilityTileData } from '../../db/modelHome';
import { buildStageMatrix } from './stageMatrix';
import type { ValueStreamRow } from './useValueStreams';

const el = (id: string, name: string): ElementsHeadRow => ({ element_id: id, name }) as unknown as ElementsHeadRow;
const stage = (id: string, name: string, enabling: string[]) => ({ stage: el(id, name), tone: 'ok', enablingCapabilityIds: enabling, fitForPurpose: null }) as unknown as ValueStreamRow['stages'][number];
const tile = (id: string, name: string, tone: string) => [id, { capability: el(id, name), tone } as unknown as CapabilityTileData] as const;

const rows = [
  { stream: el('vs1', 'Get connected'), inactive: false, rollup: { tone: 'ok' }, stages: [stage('s1', 'Apply', ['c2', 'c1']), stage('s2', 'Build', ['c1'])] },
  { stream: el('vs2', 'Old stream'), inactive: true, rollup: { tone: 'ok' }, stages: [stage('s3', 'Gone', ['c3'])] },
  { stream: el('vs3', 'Look after customers'), inactive: false, rollup: { tone: 'ok' }, stages: [stage('s4', 'Contact', [])] },
] as unknown as ValueStreamRow[];

describe('buildStageMatrix', () => {
  const matrix = buildStageMatrix(rows, new Map([tile('c1', 'Wayleaves', 'warn'), tile('c2', 'Connections', 'ok'), tile('c3', 'Archive', 'ok')]));

  it('has one column per stage of every active stream, in page order', () => {
    expect(matrix.columns.map((c) => c.stageName)).toEqual(['Apply', 'Build', 'Contact']);
  });

  it('lists each delivering capability once, sorted by name, with the stages it delivers', () => {
    expect(matrix.rows.map((r) => [r.capability.name, [...r.stageIds]])).toEqual([
      ['Connections', ['s1']],
      ['Wayleaves', ['s1', 's2']],
    ]);
  });

  it('names the stages nobody delivers, and leaves inactive streams out', () => {
    expect(matrix.undeliveredStages.map((c) => c.stageName)).toEqual(['Contact']);
    expect(matrix.rows.some((r) => r.capability.name === 'Archive')).toBe(false);
  });
});
