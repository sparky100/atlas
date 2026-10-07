import { useState } from 'react';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import styles from './DiscardCaptureButton.module.css';

export interface DiscardCaptureButtonProps {
  /** The first button's own label, e.g. "Discard" or "Discard 24 older copies". */
  label: string;
  /** What the confirm step says will happen — shown before anything is discarded. */
  confirmText: string;
  onConfirm: () => Promise<unknown>;
}

/**
 * A two-step Discard for a capture draft that may already carry review
 * decisions — the same inline confirm shape as ChangeView's "Cancel this
 * change…" rather than a native `confirm()`, so it reads the same at 390px.
 * Discarding archives the draft (`atlas.discard_capture_job`); nothing is
 * deleted, but nothing from it reaches the model either.
 */
export function DiscardCaptureButton({ label, confirmText, onConfirm }: DiscardCaptureButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => { setConfirming(true); }}>
        {label}
      </Button>
    );
  }
  return (
    <div className={styles.confirm}>
      <Text as="span" size="sm">
        {confirmText}
      </Text>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onConfirm().finally(() => {
              setBusy(false);
              setConfirming(false);
            });
          }}
        >
          {busy ? 'Discarding…' : 'Confirm discard'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => { setConfirming(false); }}>
          Keep
        </Button>
      </div>
    </div>
  );
}
