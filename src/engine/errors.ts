/**
 * The one error type every src/engine module throws for "called with input
 * that violates this function's preconditions" — an unknown commit, a
 * missing subject, a missing merge base. Shared so `instanceof EngineError`
 * means the same thing everywhere in the engine, rather than each module
 * defining its own identically-named but distinct class.
 */
export class EngineError extends Error {}
