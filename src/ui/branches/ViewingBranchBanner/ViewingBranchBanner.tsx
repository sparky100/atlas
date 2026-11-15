import { Link, useLocation, useSearchParams } from 'react-router';
import type { Ref } from '../../../db/ref';
import { Text } from '../../components/Text/Text';
import { useBranchLabel } from '../useBranchLabel';
import styles from '../EditingBranchBanner/EditingBranchBanner.module.css';

export interface ViewingBranchBannerProps {
  activeRef: Ref;
}

/**
 * S1 item 2 (docs/prompts/atlas-prompt-pack.md): "Reviewer view: review
 * request and change pages get 'View this change' ... opening a read-only
 * viewing ref with banner 'Viewing change: <name> (read-only)', edit
 * controls hidden, navigation keeps it, 'Back to the live model' exits. Distinct
 * from 'Work in this change'." Sibling to `EditingBranchBanner`, reusing
 * its exact CSS module — same shape (a label plus a trailing "Back to
 * main" link), deliberately *without* a "Submit for review" button or the
 * To-be/Diff shortcuts group: there is nothing to submit while merely
 * viewing, and Landscape/CapabilityMapPage's own `BranchViewModeControl`
 * already gives To-be/Diff independently of either banner (it only checks
 * `ref.kind === 'branch'`, not which banner is showing).
 *
 * Renders whenever `activeRef` is a `branch:` ref *and* the URL carries
 * `?viewing=1` — a page picks this banner over `EditingBranchBanner` by
 * checking `isViewingMode(searchParams)` itself (`viewingMode.ts`), the
 * same one flag that also folds into that page's own `canEdit`. "Back to
 * main" here is a plain link to the current path with `ref`/`viewing`/
 * `mode` stripped, not `clearRef()` — there is nothing in session storage
 * to clear (`SelectedRefProvider.tsx`'s own write-effect never persisted
 * a viewing ref to begin with), which is itself the proof this stays a
 * genuinely separate concept from the editing ref.
 */
export function ViewingBranchBanner({ activeRef }: ViewingBranchBannerProps) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { label } = useBranchLabel(activeRef);

  if (activeRef.kind !== 'branch') return null;

  const backToMainParams = new URLSearchParams(searchParams);
  backToMainParams.delete('ref');
  backToMainParams.delete('viewing');
  backToMainParams.delete('mode');
  const backToMainQuery = backToMainParams.toString();
  const backToMainHref = `${location.pathname}${backToMainQuery ? `?${backToMainQuery}` : ''}`;

  return (
    <div className={styles.banner} role="status">
      <Text as="span" size="sm">
        Viewing change: {label ?? activeRef.branchId.slice(0, 8)} (read-only)
      </Text>
      <Link to={backToMainHref} className={[styles.link, styles.backToMain].join(' ')}>
        Back to the live model
      </Link>
    </div>
  );
}
