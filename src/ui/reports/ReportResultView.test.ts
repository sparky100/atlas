import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ReportResult } from '../../engine/reportQuery';
import { ResultTable } from './ReportResultView';

it('shows the first report page and separately identifies the saved report limit', () => {
  const result: ReportResult = {
    columns: ['name'],
    rows: Array.from({ length: 70 }, (_, index) => [`System ${String(index + 1).padStart(2, '0')}`]),
    rowCount: 100,
    truncated: true,
    groups: [],
    unknownFields: [],
  };

  const html = renderToStaticMarkup(createElement(ResultTable, { result }));
  expect(html).toContain('System 50');
  expect(html).not.toContain('System 51');
  expect(html).toContain('This report includes 70 of 100 matching rows.');
});
