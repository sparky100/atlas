/**
 * F11: the disposition helpers (reading the attribute, order, label) live in `src/engine/elementRead/disposition.ts` (ADR-028: the tools layer needs them without importing `src/ui`). This file re-exports them and keeps the chip tone, which is UI.
 */
import type { Disposition } from '../../contracts/delta';
import type { ChipTone } from '../components/Chip/Chip';

export * from '../../engine/elementRead/disposition';

/** Chip tone — always shown with its label beside it, never colour alone. */
export function dispositionTone(value: Disposition | null): ChipTone {
  switch (value) {
    case 'invest':
      return 'ok';
    case 'tolerate':
      return 'info';
    case 'migrate':
    case 'eliminate':
      // A plan, not a fault: blue (in progress / informational), never a risk colour.
      return 'info';
    case null:
      return 'neutral';
  }
}

