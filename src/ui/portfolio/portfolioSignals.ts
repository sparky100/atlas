/** Moved to `src/engine/portfolio/portfolioSignals.ts` (ADR-028: the tools layer reads the model through the same code the pages do and must not import from `src/ui`). Re-exported here so existing imports keep working. */
export * from '../../engine/portfolio/portfolioSignals';
