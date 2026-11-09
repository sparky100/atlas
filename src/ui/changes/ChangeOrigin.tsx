import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { BranchRow } from '../../db/types';
import { getDecisionForOption } from '../../db/decisions';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { isImportChange } from './importChange';
import { Text } from '../components/Text/Text';

/**
 * "From decision: …" / "From an import" on a change page, so a change always says where it came from — the decision it is an option of links straight to it. A change with neither origin shows nothing. The project it belongs to is shown separately by `ChangeProjectAssignment`.
 */
export function ChangeOrigin({ branch, orgSlug, modelSlug }: { branch: BranchRow; orgSlug: string; modelSlug: string }) {
  const { data: decision } = useQuery({
    queryKey: ['changes', 'originDecision', branch.id],
    queryFn: async () => {
      try {
        return await getDecisionForOption(supabase, branch.id);
      } catch (e) {
        reportError("Couldn't check whether this change came from a decision.", e);
        throw e;
      }
    },
    enabled: branch.kind === 'change',
  });
  if (decision) {
    return (
      <Text as="p" size="sm" tone="muted">
        From decision: <Link to={`/o/${orgSlug}/m/${modelSlug}/decisions/${decision.id}`}>{decision.title}</Link>
      </Text>
    );
  }
  if (isImportChange(branch)) {
    return (
      <Text as="p" size="sm" tone="muted">
        From an import
      </Text>
    );
  }
  return null;
}
