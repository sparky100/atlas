import { useEffect, useState } from 'react';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import styles from './ConnectClaudeDesktop.module.css';
import { fetchMcpDownload } from './mcpVersion';
import type { McpDownload } from './mcpVersion';

/**
 * ADR-029 §3: the Home card that offers the Claude Desktop download. Shown
 * only when this deployment actually published one; otherwise nothing is
 * rendered (no dead link, no placeholder).
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
    <section className={styles.section} aria-labelledby="connect-claude-desktop">
      <Panel data-testid="connect-claude-desktop">
        <Text as="h2" size="lg" id="connect-claude-desktop">
          Connect Claude Desktop
        </Text>
        <Text as="p" tone="muted">
          Ask Claude Desktop about your models. It can only read, and only what you can already see in Atlas.
        </Text>
        <ol className={styles.steps}>
          <li>
            <a href={download.extensionUrl} download className={styles.download}>
              Download the Atlas extension
            </a>{' '}
            (version {download.version}).
          </li>
          <li>Open the downloaded file. Claude Desktop asks you to install it.</li>
          <li>Enter the email and password you use for Atlas when it asks.</li>
          <li>Ask a question, for example "Which of our systems support our most important capabilities?"</li>
        </ol>
        <Text as="p" tone="muted" size="sm">
          Your organisation&apos;s owner has to turn on Ask Atlas first (Organisation settings). It needs Node.js 20 or later on your computer.
        </Text>
      </Panel>
    </section>
  );
}
