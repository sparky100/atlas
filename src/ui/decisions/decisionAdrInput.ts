/**
 * Moved to `src/engine/decisionDigest/decisionAdrInput.ts` so a server/edge
 * module can assemble the same ADR input without importing UI code. This
 * re-export keeps every existing UI import and test unchanged.
 */
export * from '../../engine/decisionDigest/decisionAdrInput';
