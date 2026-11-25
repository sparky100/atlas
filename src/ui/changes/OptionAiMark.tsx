import { useQuery } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import { listOptionMarksForDecision } from '../../db/decisionOptionMarks';
import { getDecisionOptionForBranch } from '../../db/decisionOptions';
import { getDecisionForOption } from '../../db/decisions';
import { Chip } from '../components/Chip/Chip';
import { profileLabel } from '../comments/profileLabel';
import { optionProvenance, optionRowProvenance } from '../decisions/optionProvenance';
import { useMembers } from '../orgs/useMembers';
import { supabase } from '../supabaseClient';

/**
 * Says so when an agent drafted this option (Simon, 2026-11-20: AI help is always clearly marked), in the same
 * words the decision's option column uses. Shows nothing for an option added by hand, or while it loads.
 */
export function OptionAiMark({ orgId, branchId }: { orgId: string; branchId: UUID }) {
  const { members } = useMembers(orgId);
  const { data } = useQuery({
    queryKey: ['changes', 'optionMark', branchId],
    queryFn: async () => {
      const decision = await getDecisionForOption(supabase, branchId);
      if (!decision) return null;
      // A candidate saved from the Designer carries its mark on the option row;
      // an older option carries it in decision_option_marks.
      const option = await getDecisionOptionForBranch(supabase, decision.id, branchId);
      const mark = (await listOptionMarksForDecision(supabase, decision.id)).find((m) => m.branchId === branchId) ?? null;
      return { option, mark };
    },
  });
  const nameOf = (id: string) => profileLabel(members.find((m) => m.member.user_id === id)?.profile);
  const line = (data?.option ? optionRowProvenance(data.option, nameOf) : null) ?? optionProvenance(data?.mark ?? undefined, nameOf);
  if (line === null) return null;
  return <Chip tone="info">{line}</Chip>;
}
