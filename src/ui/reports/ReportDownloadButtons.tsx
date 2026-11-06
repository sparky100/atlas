/** ADR-027 (F14 step 5): CSV and Excel downloads for a report table (live or a saved copy). */
import { useState } from 'react';
import { downloadBlob } from '../exports/viewExport';
import type { ReportXlsxAbout } from '../exports/reportTableXlsx';
import { Button } from '../components/Button/Button';
import { reportError } from '../errors/errorBannerStore';
import { tableToCsv } from './reportTable';

function safe(s: string): string {
  return s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'report';
}

export interface ReportDownloadButtonsProps {
  table: readonly (readonly string[])[];
  /** Used for the file name, e.g. `acme-systems-past-support-2026-11-06.csv`. */
  fileBase: string;
  about: ReportXlsxAbout;
}

export function ReportDownloadButtons({ table, fileBase, about }: ReportDownloadButtonsProps) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          // A byte-order mark so Excel opens the UTF-8 file with accents intact.
          downloadBlob(new Blob(['﻿', tableToCsv(table)], { type: 'text/csv;charset=utf-8' }), `${safe(fileBase)}.csv`);
        }}
      >
        Download CSV
      </Button>
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void import('../exports/reportTableXlsx')
            .then(({ reportTableToXlsxBlob }) => {
              downloadBlob(reportTableToXlsxBlob(table, about), `${safe(fileBase)}.xlsx`);
            })
            .catch((e: unknown) => {
              reportError("Couldn't export the report.", e);
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        Download Excel
      </Button>
    </>
  );
}
