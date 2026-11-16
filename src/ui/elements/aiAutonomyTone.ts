import type { AiAutonomy } from '../../contracts/delta';
import type { ChipTone } from '../components/Chip/Chip';

/** The same risk tones Criticality uses (no new colours): strongest for "Acts alone", middle for "Acts with approval", quiet for "Suggests only". */
export const AI_AUTONOMY_TONE: Record<AiAutonomy, ChipTone> = { acts_alone: 'danger', acts_with_approval: 'warn', suggests: 'neutral' };
