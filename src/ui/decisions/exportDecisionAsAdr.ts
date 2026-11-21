/**
 * Moved to `src/engine/decisionDigest/exportDecisionAsAdr.ts` so a
 * server/edge module can build the same ADR text without importing UI code.
 * This re-export keeps every existing UI import and test unchanged.
 */
export * from '../../engine/decisionDigest/exportDecisionAsAdr';
