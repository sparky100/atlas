import { useState } from 'react';
import { downloadPlanAsPdf, downloadPlanAsPng, type ExportPlan, type ExportStamp } from '../../exports/viewExport';
import { reportError } from '../../errors/errorBannerStore';
import { Button } from '../Button/Button';

export interface ExportViewButtonsProps {
  /** Builds the picture on demand — `null` while the view has nothing loaded to draw. */
  build: () => { plan: ExportPlan; stamp: ExportStamp } | null;
  /** What the buttons export, for their accessible names — e.g. "capability map". */
  what: string;
}

/**
 * F13 step 1: "Export PNG" / "Export PDF" for a view — a stamped picture of
 * what the view shows now (`src/ui/exports/viewExport.ts`). Shared by the
 * capability map, landscape and Portfolio so all three behave the same.
 */
export function ExportViewButtons({ build, what }: ExportViewButtonsProps) {
  const [busy, setBusy] = useState<'png' | 'pdf' | null>(null);

  async function run(format: 'png' | 'pdf') {
    const built = build();
    if (!built) return;
    setBusy(format);
    try {
      await (format === 'png' ? downloadPlanAsPng(built.plan, built.stamp) : downloadPlanAsPdf(built.plan, built.stamp));
    } catch (e) {
      reportError(`Couldn't export the ${what}.`, e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button variant="secondary" disabled={busy !== null} aria-label={`Export ${what} as PNG`} onClick={() => { void run('png'); }}>
        {busy === 'png' ? 'Exporting…' : 'Export PNG'}
      </Button>
      <Button variant="secondary" disabled={busy !== null} aria-label={`Export ${what} as PDF`} onClick={() => { void run('pdf'); }}>
        {busy === 'pdf' ? 'Exporting…' : 'Export PDF'}
      </Button>
    </>
  );
}
