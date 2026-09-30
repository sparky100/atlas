/**
 * P-34 (SPEC-data-model.md §10.8, ADR-023/F6): a stage's tone equals the
 * worst of its enabling capabilities' own `CapabilityTileData.tone`, or
 * `neutral` when nothing enables it; a stream's tone equals the worst of
 * its stages'; `fitForPurpose` rolls up the same way but independently,
 * never folded into the tone. Mirrors `src/engine/mergeElements.property.test.ts`'s
 * own shape: a hand-rolled oracle, fast-check driving the input space.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FitForPurpose } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { CapabilityTileData } from '../../db/modelHome';
import { computeStageRollup, computeStreamRollup, TONE_SEVERITY, worstTone, type ValueStreamStageRollup, type ValueStreamTone } from './valueStreamRollup';

const toneArb = fc.constantFrom<ValueStreamTone>('ok', 'info', 'neutral', 'warn');
const fitArb = fc.option(fc.constantFrom<FitForPurpose>('excellent', 'good', 'adequate', 'poor'), { nil: null });
const specArb = fc.record({ tone: toneArb, fit: fitArb });

function element(elementId: string, elementType: ElementsHeadRow['element_type'], name: string, parentId: string | null = null): ElementsHeadRow {
  return { element_id: elementId, element_type: elementType, name, parent_id: parentId, attributes: {}, exists_delta_id: `create-${elementId}` };
}

function tile(capabilityId: string, tone: ValueStreamTone, fitForPurpose: FitForPurpose | null): CapabilityTileData {
  return {
    capability: element(capabilityId, 'capability', capabilityId),
    supportingSystems: [],
    exposedSystems: [],
    tone,
    supportedCapabilityCount: 0,
    totalCapabilityCount: 0,
    isOwned: false,
    fitForPurpose,
    poorFitCapabilities: [],
    poorFitAllReplacementPlanned: false,
    importance: null,
  };
}

function enables(id: string, fromElementId: string, toElementId: string): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: 'enables', from_element_id: fromElementId, to_element_id: toElementId, attributes: {}, exists_delta_id: `create-${id}` };
}

/** The oracle: worst by `TONE_SEVERITY`'s own order, `neutral` for an empty set — independent of `computeStageRollup`/`computeStreamRollup`'s own internals, the same "don't test the implementation against itself" discipline `mergeElements.property.test.ts` uses. */
function worstToneOracle(tones: readonly ValueStreamTone[]): ValueStreamTone {
  if (tones.length === 0) return 'neutral';
  return tones.reduce((worst, t) => (TONE_SEVERITY.indexOf(t) > TONE_SEVERITY.indexOf(worst) ? t : worst));
}

const FIT_ORDER: Record<FitForPurpose, number> = { excellent: 0, good: 1, adequate: 2, poor: 3 };
function worstFitOracle(fits: readonly (FitForPurpose | null)[]): FitForPurpose | null {
  let worst: FitForPurpose | null = null;
  for (const fit of fits) {
    if (fit !== null && (worst === null || FIT_ORDER[fit] > FIT_ORDER[worst])) worst = fit;
  }
  return worst;
}

describe('P-34: value-stream rollup', () => {
  it('a stage\'s tone/fitForPurpose equals the worst of its enabling capabilities\', or neutral/null when nothing enables it', () => {
    fc.assert(
      fc.property(fc.array(specArb, { minLength: 0, maxLength: 6 }), (specs) => {
        const capabilityIds: string[] = specs.map((_, i) => `cap-${String(i)}`);
        const tilesByCapabilityId = new Map<string, CapabilityTileData>(specs.map((spec, i) => [`cap-${String(i)}`, tile(`cap-${String(i)}`, spec.tone, spec.fit)]));
        const stage = element('st-1', 'value_stream', 'Stage', 'vs-1');
        const enablesEdges = specs.map((_, i) => enables(`rel-${String(i)}`, `cap-${String(i)}`, 'st-1'));

        const rollup = computeStageRollup(stage, enablesEdges, tilesByCapabilityId);

        expect(rollup.tone).toBe(worstToneOracle(specs.map((s) => s.tone)));
        expect(rollup.fitForPurpose).toEqual(worstFitOracle(specs.map((s) => s.fit)));
        expect([...rollup.enablingCapabilityIds].sort()).toEqual([...capabilityIds].sort());
      }),
    );
  });

  it('a stage never sees an enables edge targeting a different stage', () => {
    const tilesByCapabilityId = new Map([['cap-1', tile('cap-1', 'warn', 'poor')]]);
    const stage = element('st-1', 'value_stream', 'Stage', 'vs-1');
    const rollup = computeStageRollup(stage, [enables('rel-1', 'cap-1', 'st-other')], tilesByCapabilityId);
    expect(rollup).toMatchObject({ tone: 'neutral', enablingCapabilityIds: [], fitForPurpose: null });
  });

  it('a stream\'s tone/fitForPurpose equals the worst of its stages\', or neutral/null when it has none', () => {
    fc.assert(
      fc.property(fc.array(specArb, { minLength: 0, maxLength: 6 }), (specs) => {
        const stream = element('vs-1', 'value_stream', 'Stream');
        const stageRollups: ValueStreamStageRollup[] = specs.map((spec, i) => ({
          stage: element(`st-${String(i)}`, 'value_stream', `Stage ${String(i)}`, 'vs-1'),
          tone: spec.tone,
          enablingCapabilityIds: [],
          fitForPurpose: spec.fit,
        }));

        const rollup = computeStreamRollup(stream, stageRollups);

        expect(rollup.tone).toBe(worstToneOracle(specs.map((s) => s.tone)));
        expect(rollup.fitForPurpose).toEqual(worstFitOracle(specs.map((s) => s.fit)));
      }),
    );
  });

  it('worstTone follows the stated severity order (warn > neutral > info > ok) and is undefined for an empty list', () => {
    expect(worstTone(['ok', 'info'])).toBe('info');
    expect(worstTone(['info', 'neutral'])).toBe('neutral');
    expect(worstTone(['neutral', 'warn'])).toBe('warn');
    expect(worstTone(['warn', 'ok', 'info', 'neutral'])).toBe('warn');
    expect(worstTone([])).toBeUndefined();
  });
});
