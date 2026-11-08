import { Loading } from '../components/Loading/Loading';
import type { UUID } from '../../contracts/delta';
import { Text } from '../components/Text/Text';
import { useValueStreams } from './useValueStreams';
import { ValueStreamsView } from './ValueStreamsView';

export interface ValueStreamsOutcomeViewProps {
  modelId: UUID;
  orgSlug: string;
  modelSlug: string;
  /** `ModelHome`'s own already-resolved main head commit id — `useValueStreams`'s parameter comment; the director door always reads `main`. */
  mainCommitIdHint: UUID | null;
}

/**
 * The director door's "By outcome" reading (F6 Step 6, ADR-023 "Views"
 * item 2): the value-stream rows in place of the capability tile grid. A
 * deliberately tiny child component so `useValueStreams` only ever runs
 * when the director has actually toggled to "By outcome" — the same
 * "child hooks never run unless their data is needed" principle
 * `ModelHome.tsx`'s own `DirectorDoor`/`ArchitectDoor` split already uses.
 * Read-only: each stage tile links to the stage's element page, not the
 * shared Inspector (the director door has no Inspector).
 */
export function ValueStreamsOutcomeView({ modelId, orgSlug, modelSlug, mainCommitIdHint }: ValueStreamsOutcomeViewProps) {
  const state = useValueStreams(modelId, { kind: 'main' }, mainCommitIdHint);
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') return <Text as="p">{state.message}</Text>;
  if (state.status === 'refNotFound') return <Text as="p">Nothing here yet.</Text>;
  return <ValueStreamsView rows={state.data.rows} compact elementHref={(id) => `/o/${orgSlug}/m/${modelSlug}/e/${id}`} />;
}
