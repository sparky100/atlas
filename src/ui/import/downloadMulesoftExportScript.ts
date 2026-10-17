/**
 * Capture dialog's "Download the export script" for the MuleSoft source:
 * `docs/import/mulesoft/mulesoft-export.mjs`, bundled with Vite's `?raw`
 * import (one canonical copy in `docs/`, same as `downloadImportPrompt.ts`'s
 * own template) and handed to the browser as a file the user runs with Node.
 */
import exportScript from '../../../docs/import/mulesoft/mulesoft-export.mjs?raw';

export const MULESOFT_EXPORT_SCRIPT_FILENAME = 'mulesoft-export.mjs';

export function downloadMulesoftExportScript(): void {
  const url = URL.createObjectURL(new Blob([exportScript], { type: 'text/javascript' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = MULESOFT_EXPORT_SCRIPT_FILENAME;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
