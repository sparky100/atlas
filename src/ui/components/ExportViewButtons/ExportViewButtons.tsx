import { useState } from 'react';
import { downloadBlob, downloadPlanAsPdf, downloadPlanAsPng, exportFilename, type ExportPlan, type ExportStamp } from '../../exports/viewExport';
import { reportError } from '../../errors/errorBannerStore';
import { Button } from '../Button/Button';

export interface ExportViewButtonsProps {
  /** Builds the picture on demand — `null` while the view has nothing loaded to draw. */
  build: () => { plan: ExportPlan; stamp: ExportStamp } | null;
  /** What the buttons export, for their accessible names — e.g. "capability map". */
  what: string;
  /** The view is waiting for the complete result needed for export. */
  disabled?: boolean;
  /**
   * Which downloads to offer, in order. Defaults to PNG and PDF (the pictures the capability map and landscape are); a table-shaped view like the Portfolio asks for `['xlsx', 'pdf']` instead — a PNG of a table is worse than a spreadsheet.
   */
  formats?: readonly ExportFormat[];
  /** Builds the Excel file; required when `formats` includes `'xlsx'`. Loaded on demand by the caller. */
  buildXlsx?: () => Promise<Blob> | Blob;
}

export type ExportFormat = 'png' | 'pdf' | 'xlsx';

const FORMAT_LABEL: Record<ExportFormat, string> = { png: 'PNG', pdf: 'PDF', xlsx: 'Excel' };

/**
 * F13 step 1: "Export PNG" / "Export PDF" for a view — a stamped picture of
 * what the view shows now (`src/ui/exports/viewExport.ts`). Shared by the
 * capability map, landscape and Portfolio so all three behave the same.
 */
export function ExportViewButtons({ build, what, disabled = false, formats = ['png', 'pdf'], buildXlsx }: ExportViewButtonsProps) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  async function run(format: ExportFormat) {
    if (disabled || busy !== null) return;
    const built = build();
    if (!built) return;
    setBusy(format);
    try {
      if (format === 'xlsx') {
        if (!buildXlsx) throw new Error('ExportViewButtons: "xlsx" was offered without a buildXlsx.');
        downloadBlob(await buildXlsx(), exportFilename(built.stamp, 'xlsx'));
      } else {
        await (format === 'png' ? downloadPlanAsPng(built.plan, built.stamp) : downloadPlanAsPdf(built.plan, built.stamp));
      }
    } catch (e) {
      reportError(`Couldn't export the ${what}.`, e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {formats.map((format) => (
        <Button
          key={format}
          variant="secondary"
          disabled={disabled || busy !== null}
          aria-label={`Export ${what} as ${FORMAT_LABEL[format]}`}
          onClick={() => {
            void run(format);
          }}
        >
          {busy === format ? 'Exporting…' : `Export ${FORMAT_LABEL[format]}`}
        </Button>
      ))}
    </>
  );
}
