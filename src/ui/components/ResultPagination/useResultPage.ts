import { useMemo, useState } from 'react';

const PAGE_SIZE = 50;

/** Page the presentation after filtering and sorting. A new result starts at its first page. */
export function useResultPage<Row>(rows: readonly Row[] | undefined, paginate = true) {
  const [selection, setSelection] = useState<{ rows: readonly Row[] | undefined; index: number }>({ rows, index: 0 });
  const total = rows?.length ?? 0;
  const index = paginate && selection.rows === rows ? selection.index : 0;
  const start = index * PAGE_SIZE;
  const end = paginate ? Math.min(start + PAGE_SIZE, total) : total;
  const pageRows = useMemo(() => paginate ? rows?.slice(start, end) ?? [] : rows ?? [], [rows, start, end, paginate]);

  return {
    rows: pageRows,
    start,
    end,
    total,
    paginated: paginate && total > PAGE_SIZE,
    previous: () => { if (index > 0) setSelection({ rows, index: index - 1 }); },
    next: () => { if (end < total) setSelection({ rows, index: index + 1 }); },
  };
}
