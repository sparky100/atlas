import { useState } from 'react';
import { useLocation } from 'react-router';
import { buildShareUrl, isOnChange, type ShareTarget } from '../../nav/shareLink';
import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import styles from './ShareButton.module.css';

/**
 * "Share" — copies a link to the page being viewed (nav/shareLink.ts for
 * what the link keeps and drops). Inside a change it offers a choice
 * between the main model (the default) and the change itself.
 */
export function ShareButton() {
  const location = useLocation();
  const [choosing, setChoosing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const onChange = isOnChange(location.search);

  async function copy(target: ShareTarget) {
    const url = buildShareUrl(window.location.origin, location.pathname, location.search, target);
    setChoosing(false);
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Link copied');
    } catch {
      setMessage(`Copy this link: ${url}`);
    }
  }

  return (
    <span className={styles.share}>
      {choosing ? (
        <>
          <Button variant="ghost" onClick={() => void copy('main')}>
            Link to the main model
          </Button>
          <Button variant="ghost" onClick={() => void copy('change')}>
            Link to this change
          </Button>
        </>
      ) : (
        <Button variant="ghost" onClick={() => {
            if (onChange) setChoosing(true);
            else void copy('main');
          }}>
          Share
        </Button>
      )}
      <span role="status" aria-live="polite">
        {message && (
          <Text as="span" size="sm" tone="faint">
            {message}
          </Text>
        )}
      </span>
    </span>
  );
}
