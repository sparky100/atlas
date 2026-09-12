import type { BackfillCapabilityOrderStatus } from './useBackfillCapabilityOrder';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import styles from './BackfillCapabilityOrderAction.module.css';

export interface BackfillCapabilityOrderActionProps {
  status: BackfillCapabilityOrderStatus;
  message: string | null;
  error: string | null;
  onBackfill: () => void;
}

/**
 * S1 item 13's owner-only "Backfill capability order" maintenance action —
 * `ghost`, same reasoning as `ExportCapabilityMapAction.tsx`'s own comment:
 * a maintenance affordance, not part of the map's normal workflow. Unlike
 * Export, this one takes no input at all — one click runs
 * `backfillCapabilityOrder` for the whole model, in one commit, and
 * reports how many capabilities it touched (or that there was nothing to
 * do), so no `open`/collapsed form state is needed here.
 *
 * Purely presentational — `CapabilityMapPage.tsx` owns the
 * `useBackfillCapabilityOrder` call itself and passes its result down as
 * props, rather than this component calling the hook locally the way
 * `ExportCapabilityMapAction` does. That's deliberate, not a stylistic
 * choice: a real backfill's own `onBackfilled` reloads the page's whole
 * capability tree, which cycles `CapabilityMapPage`'s `state.status`
 * through `'loading'` — the header's entire actions block (this
 * component's own mount point) is gated on `state.status === 'ready'`, so
 * a `useBackfillCapabilityOrder` call living *inside* this component would
 * unmount together with its own just-set success message the instant the
 * reload it triggered started, before anyone could read it (found live via
 * this item's own e2e run). Owning the hook one level up, in the page that
 * stays mounted across that cycle, is what lets the message actually
 * survive to be seen.
 *
 * `CapabilityMapPage.tsx` mounts this only for `canBackfillCapabilityOrder`
 * (owner only, narrower than the `canEdit` gate the rest of the overflow
 * menu uses) — see that gate's own comment in `roleGates.ts` for why this
 * is narrower than Export's owner-or-architect floor.
 */
export function BackfillCapabilityOrderAction({ status, message, error, onBackfill }: BackfillCapabilityOrderActionProps) {
  return (
    <div className={styles.wrapper}>
      <Button variant="ghost" disabled={status === 'backfilling'} onClick={onBackfill}>
        {status === 'backfilling' ? 'Backfilling…' : 'Backfill capability order'}
      </Button>
      {message !== null && (
        <Text as="p" tone="muted" size="sm">
          {message}
        </Text>
      )}
      {error !== null && (
        <Text as="p" size="sm">
          {error}
        </Text>
      )}
    </div>
  );
}
