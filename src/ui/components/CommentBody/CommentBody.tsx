import { Fragment } from 'react';
import { splitMentionSpans } from '../../comments/commentBodyRender';
import { Text } from '../Text/Text';
import styles from './CommentBody.module.css';

export interface CommentBodyProps {
  body: string;
}

/** A comment's own body, `@mentions` rendered accent-weighted (Sprint M1b) — the read side of `CommentComposer`'s write side. */
export function CommentBody({ body }: CommentBodyProps) {
  const spans = splitMentionSpans(body);
  return (
    <Text as="p" size="sm" className={styles.body}>
      {spans.map((span, i) =>
        span.kind === 'mention' ? (
          <span key={i} className={styles.mention}>
            @{span.handle}
          </span>
        ) : (
          <Fragment key={i}>{span.text}</Fragment>
        ),
      )}
    </Text>
  );
}
