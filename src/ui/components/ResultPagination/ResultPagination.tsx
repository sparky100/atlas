import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import styles from './ResultPagination.module.css';

interface ResultPaginationProps {
  label: string;
  start: number;
  end: number;
  total: number;
  paginated: boolean;
  previous: () => void;
  next: () => void;
}

export function ResultPagination({ label, start, end, total, paginated, previous, next }: ResultPaginationProps) {
  if (!paginated) return null;
  return (
    <nav aria-label={label} className={styles.pagination}>
      <span role="status"><Text size="sm">Showing {start + 1}–{end} of {total}</Text></span>
      <Button aria-disabled={start === 0} onClick={previous}>Previous page</Button>
      <Button aria-disabled={end === total} onClick={next}>Next page</Button>
    </nav>
  );
}
