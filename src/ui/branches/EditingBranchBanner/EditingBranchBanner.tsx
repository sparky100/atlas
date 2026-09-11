import { useSearchParams } from 'react-router';
import type { Ref } from '../../../db/ref';
import type { ViewMode } from '../../../db/viewMode';
import { Text } from '../../components/Text/Text';
import { useBranchLabel } from '../useBranchLabel';
import styles from './EditingBranchBanner.module.css';

export interface EditingBranchBannerProps {
  activeRef: Ref;
  /**
   * Whether this page's own `?mode=` (As-is/To-be/Diff, `BranchViewModeControl`)
   * is actually consumed — Landscape/Context/Container/Component all are;
   * CapabilityMapPage, ElementPage and ModelHome are not (no diff
   * highlighting exists on any of them yet). Omitted entirely rather than
   * shown as a shortcut that visibly does nothing, same convention
   * `ElementHeader.tsx`'s own `onEdit`/`rename` props already use.
   * Defaults `true` since most callers do support it.
   */
  showModeShortcuts?: boolean;
}

/**
 * Sprint 7i item 2: "While a change is selected, every page shows a
 * persistent banner: 'Editing in change: <name>' with To-be/Diff shortcuts
 * and 'Back to main'; save toasts say the edit went to the change" (the
 * toast half is `toastStore.ts`/`ToastHost.tsx`).
 *
 * Self-contained — one line per route (`<EditingBranchBanner activeRef={ref} />`,
 * right inside `<main>`, before the breadcrumb) rather than a shared
 * `AppShell` wrapper: no such wrapper exists anywhere in this codebase yet
 * (every route independently renders `AppHeader`/`ModelNav` itself), and
 * introducing one is a structural refactor this feature doesn't need to
 * bundle with. Resolves its own branch label via `useBranchLabel` (the
 * same hook `ContextPage.tsx`/`ContainerPage.tsx`/`ComponentPage.tsx`
 * already call) rather than requiring every caller to have a `BranchRow`
 * in hand — `LandscapePage.tsx`/`CapabilityMapPage.tsx`/`ModelHome.tsx`
 * don't otherwise need one.
 *
 * Renders nothing outside a `branch:` ref — "a change is selected" per the
 * prompt's own wording, not "this page happens to support editing it"
 * (`CapabilityMapPage.tsx` can display a branch's own state today without
 * being able to edit into it at all; the banner's job is orientation, not
 * a promise that this exact page is writable).
 */
export function EditingBranchBanner({ activeRef, showModeShortcuts = true }: EditingBranchBannerProps) {
  const [, setSearchParams] = useSearchParams();
  const { label } = useBranchLabel(activeRef);

  if (activeRef.kind !== 'branch') return null;

  const setMode = (mode: ViewMode) => {
    setSearchParams((prev) => {
      const updated = new URLSearchParams(prev);
      updated.set('mode', mode);
      return updated;
    });
  };

  const backToMain = () => {
    setSearchParams((prev) => {
      const updated = new URLSearchParams(prev);
      updated.delete('ref');
      // Meaningless once back at main — the As-is/To-be/Diff control itself
      // is hidden there (UI-principles §6.2), so a stale `?mode=diff` left
      // in the URL would be inert clutter, not a real state.
      updated.delete('mode');
      return updated;
    });
  };

  return (
    <div className={styles.banner} role="status">
      <Text as="span" size="sm">
        Editing in change: {label ?? activeRef.branchId.slice(0, 8)}
      </Text>
      {showModeShortcuts && (
        <div className={styles.shortcuts}>
          <button type="button" className={styles.link} onClick={() => { setMode('toBe'); }}>
            To-be
          </button>
          <button type="button" className={styles.link} onClick={() => { setMode('diff'); }}>
            Diff
          </button>
        </div>
      )}
      <button type="button" className={[styles.link, styles.backToMain].join(' ')} onClick={backToMain}>
        Back to main
      </button>
    </div>
  );
}
