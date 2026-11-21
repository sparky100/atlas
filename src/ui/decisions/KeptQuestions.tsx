/**
 * D2 PR 4: questions an AI reviewer drafted that a person chose to keep.
 * Rendered on the decision page and included in the frozen pack. A kept
 * question is not an approval, not a "concern" (those are element links), and
 * never changes the live model.
 */
import { useQuery } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import type { DecisionAgentNote, DecisionAgentNoteLens } from '../../contracts/decisionAgentNote';
import { listDecisionAgentNotes } from '../../db/decisionAgentNotes';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';

const LENS_NAME: Readonly<Record<DecisionAgentNoteLens, string>> = {
  challenge: 'Challenger',
  cyber: 'Steward: cyber',
  data: 'Steward: data',
};

function keptQuestionLabel(note: DecisionAgentNote): string {
  return LENS_NAME[note.lens];
}

export function KeptQuestions({ decisionId, nameOfUser }: { decisionId: UUID; nameOfUser?: ((id: UUID) => string) | undefined }) {
  const { data } = useQuery({
    queryKey: ['decisionAgentNotes', decisionId],
    queryFn: () => listDecisionAgentNotes(supabase, decisionId),
  });
  if (data === undefined || data.length === 0) return null;
  return (
    <Panel data-testid="kept-questions">
      <Text as="h2" size="lg">Questions raised by an AI reviewer</Text>
      <Text as="p" size="sm" tone="muted">
        Questions a person chose to keep on this decision. They are not a review, clearance or sign-off, and they do not change the model.
      </Text>
      <ul>
        {data.map((note) => (
          <li key={note.id}>
            <Text as="p">{note.question}</Text>
            <Text as="p" size="sm" tone="muted">
              {keptQuestionLabel(note)} · kept by {nameOfUser ? nameOfUser(note.keptBy) : 'a member'} on {note.keptAt.slice(0, 10)}
              {note.basedOn !== 'none' && note.basedOnLabel !== null ? ` · based on ${note.basedOnLabel}` : ''}
            </Text>
            {note.suggestedQuestion !== note.question && (
              <Text as="p" size="sm" tone="muted">Original AI wording: {note.suggestedQuestion}</Text>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
