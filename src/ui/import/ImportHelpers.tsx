/**
 * The two ways to prepare a file before uploading, shown on the Import page
 * itself: a blank spreadsheet with the standard columns, and the AI prompt
 * for turning notes into an import file. Neither is a second import route —
 * both produce a file the one upload reads and the one review checks.
 */
import type { UUID } from '../../contracts/delta';
import { supabase } from '../supabaseClient';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { downloadImportPrompt } from './downloadImportPrompt';
import { downloadImportTemplate } from './downloadImportTemplate';

export function ImportHelpers({ modelId, modelSlug }: { modelId: UUID; modelSlug: string }) {
  return (
    <div role="group" aria-label="Prepare a file to import">
      <Text as="p" size="sm" tone="muted">
        Starting from your own list? Download a blank spreadsheet with the standard columns, or an AI prompt that turns your notes into a file Atlas reads.
      </Text>
      <Button variant="secondary" onClick={downloadImportTemplate}>
        Download a blank spreadsheet
      </Button>
      <Button variant="ghost" onClick={() => void downloadImportPrompt(supabase, modelId, modelSlug)}>
        AI prompt for preparing an import file
      </Button>
    </div>
  );
}
