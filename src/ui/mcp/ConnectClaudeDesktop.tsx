import { useEffect, useState } from 'react';
import { Text } from '../components/Text/Text';
import styles from './ConnectClaudeDesktop.module.css';
import { fetchMcpDownload } from './mcpVersion';
import type { McpDownload } from './mcpVersion';

/**
 * ADR-029 §3: the quiet Home offer of the Claude Desktop download. One small
 * line with the download link; the install steps fold away until asked for.
 * Shown only when this deployment actually published one; otherwise nothing
 * is rendered (no dead link, no placeholder).
 */
export function ConnectClaudeDesktop() {
  const [download, setDownload] = useState<McpDownload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchMcpDownload().then((found) => {
      if (!cancelled) setDownload(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (download === null) return null;
  return (
    <section className={styles.section} aria-label="Claude Desktop" data-testid="connect-claude-desktop">
      <Text as="p" tone="muted" size="sm">
        Use Atlas from Claude Desktop:{' '}
        <a href={download.extensionUrl} download className={styles.download}>
          Download the Atlas extension
        </a>{' '}
        (version {download.version}).
      </Text>
      <details className={styles.details}>
        <summary>How to set it up</summary>
        <Text as="p" tone="muted" size="sm">
          Ask Claude Desktop about your models. It can only read, and only what you can already see in Atlas.
        </Text>
        <ol className={styles.steps}>
          <li>Open the downloaded file. Claude Desktop asks you to install it.</li>
          <li>Enter the email and password you use for Atlas when it asks.</li>
          <li>Ask a question, for example "Which of our systems support our most important capabilities?"</li>
        </ol>
        <Text as="p" tone="muted" size="sm">
          Your organisation&apos;s owner has to turn on Ask Atlas first (Organisation settings). It needs Node.js 20 or later on your computer.
        </Text>
      </details>
    </section>
  );
}
