import { Fragment } from 'react';
import { Text } from '../components/Text/Text';
import { parsePackDocument, type InlinePart, type PackBlock } from './packDocument';
import styles from './PackDocument.module.css';

function Inline({ parts }: { parts: readonly InlinePart[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p.bold ? <strong>{p.text}</strong> : p.italic ? <em>{p.text}</em> : p.text}</Fragment>
      ))}
    </>
  );
}

function Block({ block }: { block: PackBlock }) {
  switch (block.kind) {
    case 'title':
      return (
        <Text as="h3" size="lg">
          <Inline parts={block.parts} />
        </Text>
      );
    case 'facts':
      return (
        <dl className={styles.facts}>
          {block.facts.map((f, i) => (
            <div key={i} className={styles.fact}>
              <dt>{f.label}</dt>
              <dd>
                <Inline parts={f.parts} />
              </dd>
            </div>
          ))}
        </dl>
      );
    case 'heading':
      return (
        <Text as="h4" size="md">
          {block.text}
        </Text>
      );
    case 'paragraph':
      return (
        <Text as="p">
          <Inline parts={block.parts} />
        </Text>
      );
    case 'list':
      return (
        <ul className={styles.list}>
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline parts={item.parts} />
              {item.details.length > 0 && (
                <ul className={styles.details}>
                  {item.details.map((d, j) => (
                    <li key={j}>
                      <Inline parts={d} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      );
  }
}

/** A frozen pack read as a document: the outcome first, then the options and the reasons. The exact frozen text stays one click away. */
export function PackDocument({ markdown }: { markdown: string }) {
  const blocks = parsePackDocument(markdown);
  return (
    <div className={styles.document} data-testid="pack-document">
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
      <details className={styles.raw}>
        <summary>Show the exact frozen text</summary>
        <pre className={styles.rawBody}>{markdown}</pre>
      </details>
    </div>
  );
}
