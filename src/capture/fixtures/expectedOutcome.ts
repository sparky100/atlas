/**
 * F2 (full K1) PR10, SPEC-capture.md §12.3/§12.4: the `ExpectedOutcome` type
 * and the scorer both `src/capture/fixtures.test.ts` (the regression suite,
 * gated into `pnpm test`) and `scripts/scoreCapture.ts` (the human-readable
 * report) call — one scoring implementation, never a second oracle (§12.4's
 * own words).
 *
 * Scope, disclosed: every metric §12.4's table names is computed, except
 * "calibration" (a cross-fixture rollup meaningful only once every fixture,
 * 01-10, exists — PR13 adds 08-10) and "determinism"/"failure exactness"
 * (both asserted directly in `fixtures.test.ts` itself, not through this
 * per-candidate scorer, since neither is a per-candidate check).
 */
import type { CandidateClass, CaptureAliasType } from '../../contracts/capture';
import type { ElementType, RelationshipType, UUID } from '../../contracts/delta';
import { deepEqualJson } from '../classify';
import type { RunCaptureResult } from '../runCapture';

export type ExpectedMatchLevel = 'exact_id' | 'alias' | 'name_context' | 'none';

export interface ExpectedCandidate {
  kind: 'element' | 'relationship';
  class: CandidateClass;
  elementType?: ElementType;
  relationshipType?: RelationshipType;
  matchLevel?: ExpectedMatchLevel;
  /** A `model.json` element key (§12.3) — resolved to a real id via `LoadedFixture.keyToId` before comparing against `candidate.match.elementId`/`draftSubjectId`. */
  matchElement?: string;
  /** A relationship candidate's own resolved `from`/`to` endpoint (`proposal.from`/`proposal.to`, `{kind:'existing', elementId}` by the time `runCapture()` returns it) — a `model.json` key, same resolution as `matchElement`. Not part of §12.3's own type (a relationship's own `match` is always `none`, §4.4's ambiguity band being an element-name concept), added here since verifying which capability/system/actor a relationship actually landed on is exactly what a fixture needs to prove §7.4's own resolution worked. */
  matchFrom?: string;
  matchTo?: string;
  /** Unlisted attributes are unconstrained; listed ones must deep-equal. */
  attributes?: Record<string, unknown>;
  confidence?: { min: number; max: number };
  /** Must be present (subset of the candidate's own `evidence.warnings` codes). */
  warnings?: string[];
  aliasProposals?: { type: CaptureAliasType; value: string }[];
}

export interface ExpectedOutcome {
  job: { status: 'parsed' | 'failed'; errorCode?: string; stats?: Partial<Record<string, number>> };
  /** Keyed by `row_key` — every listed candidate must exist; unlisted fields on it are unconstrained. */
  candidates: Record<string, ExpectedCandidate>;
  /** Row keys that must NOT appear as candidates. */
  absent: string[];
  live?: { minElementRecall: number; minElementPrecision: number; maxUnsourced: number };
}

export interface FixtureScore {
  fixtureId: string;
  pass: boolean;
  failures: string[];
  metrics: {
    elementRecall: number;
    elementPrecision: number;
    relationshipRecall: number;
    relationshipPrecision: number;
    classAccuracy: number;
    matchAccuracy: number;
    attributeAccuracy: number;
    confidenceInRange: number;
    falseMergeCount: number;
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function scoreFixture(fixtureId: string, result: RunCaptureResult, expected: ExpectedOutcome, keyToId: ReadonlyMap<string, UUID>): FixtureScore {
  const failures: string[] = [];
  const emptyMetrics: FixtureScore['metrics'] = { elementRecall: 1, elementPrecision: 1, relationshipRecall: 1, relationshipPrecision: 1, classAccuracy: 1, matchAccuracy: 1, attributeAccuracy: 1, confidenceInRange: 1, falseMergeCount: 0 };

  if (expected.job.status === 'failed') {
    if (result.status !== 'failed') failures.push('job.status: expected "failed", got "parsed"');
    else if (expected.job.errorCode !== undefined && result.errorCode !== expected.job.errorCode) failures.push(`job.errorCode: expected "${expected.job.errorCode}", got "${result.errorCode}"`);
    return { fixtureId, pass: failures.length === 0, failures, metrics: emptyMetrics };
  }

  if (result.status !== 'parsed') {
    failures.push(`job.status: expected "parsed", got "failed" (${result.errorCode}: ${result.message})`);
    return { fixtureId, pass: false, failures, metrics: emptyMetrics };
  }

  const byRowKey = new Map(result.candidates.map((c) => [c.rowKey, c]));

  for (const rowKey of expected.absent) {
    if (byRowKey.has(rowKey)) failures.push(`absent: row_key "${rowKey}" must not appear as a candidate`);
  }

  const expectedEntries = Object.entries(expected.candidates);
  const expectedElements = expectedEntries.filter(([, c]) => c.kind === 'element');
  const expectedRelationships = expectedEntries.filter(([, c]) => c.kind === 'relationship');
  const foundElementKeys = new Set(result.candidates.filter((c) => c.kind === 'element').map((c) => c.rowKey));
  const foundRelationshipKeys = new Set(result.candidates.filter((c) => c.kind === 'relationship').map((c) => c.rowKey));

  const elementsFound = expectedElements.filter(([rowKey]) => foundElementKeys.has(rowKey));
  const relationshipsFound = expectedRelationships.filter(([rowKey]) => foundRelationshipKeys.has(rowKey));
  const elementRecall = ratio(elementsFound.length, expectedElements.length);
  const relationshipRecall = ratio(relationshipsFound.length, expectedRelationships.length);
  if (elementRecall < 1) failures.push(`element recall ${elementRecall.toFixed(2)}: missing ${expectedElements.filter(([k]) => !foundElementKeys.has(k)).map(([k]) => k).join(', ')}`);
  if (relationshipRecall < 1) failures.push(`relationship recall ${relationshipRecall.toFixed(2)}: missing ${expectedRelationships.filter(([k]) => !foundRelationshipKeys.has(k)).map(([k]) => k).join(', ')}`);

  // Precision: a produced candidate not covered by `expected.candidates` and not forbidden by `absent` is "unconstrained" (passes) — §12.4's own wording. Only an `absent` violation (already checked above) counts against it.
  const elementPrecision = ratio(foundElementKeys.size - [...foundElementKeys].filter((k) => expected.absent.includes(k)).length, foundElementKeys.size);
  const relationshipPrecision = ratio(foundRelationshipKeys.size - [...foundRelationshipKeys].filter((k) => expected.absent.includes(k)).length, foundRelationshipKeys.size);

  let classMatches = 0;
  let classChecked = 0;
  let matchMatches = 0;
  let matchChecked = 0;
  let attrMatches = 0;
  let attrChecked = 0;
  let confMatches = 0;
  let confChecked = 0;
  let falseMerges = 0;

  for (const [rowKey, expectedCandidate] of expectedEntries) {
    const actual = byRowKey.get(rowKey);
    if (!actual) continue; // already counted against recall.

    if (expectedCandidate.elementType !== undefined && actual.elementType !== expectedCandidate.elementType) failures.push(`${rowKey}: expected elementType "${expectedCandidate.elementType}", got "${String(actual.elementType)}"`);
    if (expectedCandidate.relationshipType !== undefined && actual.relationshipType !== expectedCandidate.relationshipType) failures.push(`${rowKey}: expected relationshipType "${expectedCandidate.relationshipType}", got "${String(actual.relationshipType)}"`);

    classChecked++;
    if (actual.class === expectedCandidate.class) classMatches++;
    else failures.push(`${rowKey}: expected class "${expectedCandidate.class}", got "${actual.class}"`);

    if (expectedCandidate.matchLevel !== undefined) {
      matchChecked++;
      if (actual.match.level === expectedCandidate.matchLevel) matchMatches++;
      else failures.push(`${rowKey}: expected matchLevel "${expectedCandidate.matchLevel}", got "${actual.match.level}"`);
    }
    if (expectedCandidate.matchElement !== undefined) {
      matchChecked++;
      const expectedId = keyToId.get(expectedCandidate.matchElement);
      if (expectedId === undefined) failures.push(`${rowKey}: expected.json names unknown model.json key "${expectedCandidate.matchElement}"`);
      else if (actual.match.elementId === expectedId || actual.draftSubjectId === expectedId) matchMatches++;
      else {
        falseMerges++;
        failures.push(`${rowKey}: expected match/target "${expectedCandidate.matchElement}" (${expectedId}), got elementId "${String(actual.match.elementId)}" / draftSubjectId "${String(actual.draftSubjectId)}"`);
      }
    }

    for (const [label, expectedKey, actualRef] of [
      ['matchFrom', expectedCandidate.matchFrom, actual.proposal.kind === 'relationship' ? actual.proposal.from : undefined],
      ['matchTo', expectedCandidate.matchTo, actual.proposal.kind === 'relationship' ? actual.proposal.to : undefined],
    ] as const) {
      if (expectedKey === undefined) continue;
      matchChecked++;
      const expectedId = keyToId.get(expectedKey);
      const actualId = actualRef?.kind === 'existing' ? actualRef.elementId : undefined;
      if (expectedId === undefined) failures.push(`${rowKey}: expected.json names unknown model.json key "${expectedKey}" for ${label}`);
      else if (actualId === expectedId) matchMatches++;
      else {
        falseMerges++;
        failures.push(`${rowKey}: expected ${label} "${expectedKey}" (${expectedId}), got "${String(actualId)}"`);
      }
    }

    if (expectedCandidate.attributes) {
      const actualAttributes = actual.proposal.attributes as Record<string, unknown>;
      for (const [attr, value] of Object.entries(expectedCandidate.attributes)) {
        attrChecked++;
        if (deepEqualJson(actualAttributes[attr], value)) attrMatches++;
        else failures.push(`${rowKey}.${attr}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actualAttributes[attr])}`);
      }
    }

    if (expectedCandidate.confidence) {
      confChecked++;
      const { min, max } = expectedCandidate.confidence;
      if (actual.confidence >= min && actual.confidence <= max) confMatches++;
      else failures.push(`${rowKey}: expected confidence in [${String(min)}, ${String(max)}], got ${String(actual.confidence)}`);
    }

    if (expectedCandidate.warnings) {
      const actualCodes = new Set(actual.evidence.warnings.map((w) => w.code));
      for (const code of expectedCandidate.warnings) {
        if (!actualCodes.has(code as never)) failures.push(`${rowKey}: expected warning "${code}" to be present, was not`);
      }
    }

    if (expectedCandidate.aliasProposals) {
      for (const expectedAlias of expectedCandidate.aliasProposals) {
        const has = actual.aliasProposals.some((a) => a.type === expectedAlias.type && a.value === expectedAlias.value);
        if (!has) failures.push(`${rowKey}: expected aliasProposal ${JSON.stringify(expectedAlias)} to be present, was not`);
      }
    }
  }

  const metrics: FixtureScore['metrics'] = {
    elementRecall,
    elementPrecision,
    relationshipRecall,
    relationshipPrecision,
    classAccuracy: ratio(classMatches, classChecked),
    matchAccuracy: ratio(matchMatches, matchChecked),
    attributeAccuracy: ratio(attrMatches, attrChecked),
    confidenceInRange: ratio(confMatches, confChecked),
    falseMergeCount: falseMerges,
  };

  return { fixtureId, pass: failures.length === 0, failures, metrics };
}
