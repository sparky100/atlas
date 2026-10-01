import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { isDecisionOption, setChangeProject } from '../../db/projects';
import type { BranchRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { ProjectAssignment } from './ProjectAssignment';

/**
 * F10 step 4: "Project: …" on a change page. Movable while the change is
 * open (P2) by anyone who may edit change metadata; a decision's option
 * is shown locked — it moves with its decision (P1).
 */
export function ChangeProjectAssignment({ branch, modelId, orgSlug, modelSlug, canEdit, onMoved }: { branch: BranchRow; modelId: UUID; orgSlug: string; modelSlug: string; canEdit: boolean; onMoved: () => void }) {
  const [isOption, setIsOption] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    isDecisionOption(supabase, branch.id).then(
      (value) => {
        if (!cancelled) setIsOption(value);
      },
      (e: unknown) => {
        reportError("Couldn't check whether this change is a decision's option.", e);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [branch.id]);

  if (branch.kind !== 'change') return null;
  const open = branch.status === 'draft' || branch.status === 'proposed' || branch.status === 'in_review' || branch.status === 'approved';
  return (
    <ProjectAssignment
      modelId={modelId}
      orgSlug={orgSlug}
      modelSlug={modelSlug}
      currentProjectId={branch.project_id}
      canMove={canEdit && open && isOption !== null}
      lockedReason={isOption === true ? 'Moves with its decision.' : null}
      onMove={async (projectId) => {
        await setChangeProject(supabase, branch.id, projectId);
        onMoved();
      }}
    />
  );
}
