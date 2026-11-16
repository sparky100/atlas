/**
 * The two ways to prepare a file before uploading, shown on the Import page
 * only (not repeated inside the New import dialog, where the person already has a file): a blank spreadsheet with the standard columns, and the AI prompt
 * for turning notes into an import file. Neither is a second import route —
 * both produce a file the one upload reads and the one review checks.
 */
import type { UUID } from '../../contracts/delta';
import { supabase } from '../supabaseClient';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import styles from './ImportHelpers.module.css';
import { downloadImportPrompt } from './downloadImportPrompt';
import { downloadImportTemplate } from './downloadImportTemplate';

export function ImportHelpers({ modelId, modelSlug, prominent = false }: { modelId: UUID; modelSlug: string; /** No imports yet: the first thing a new user needs is a file, so give the download a panel of its own. */ prominent?: boolean }) {
  return (
    <div role="group" aria-label="Prepare a file to import" className={prominent ? styles.prominent : styles.compact}>
      <Text as="p" size="sm" tone="muted">
        Starting from your own list? Download a blank spreadsheet with the standard columns, or an AI prompt that turns your notes into a file Atlas reads.
      </Text>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={downloadImportTemplate}>
          Download a blank spreadsheet
        </Button>
        <Button variant="ghost" onClick={() => void downloadImportPrompt(supabase, modelId, modelSlug)}>
          AI prompt for preparing an import file
        </Button>
      </div>
    </div>
  );
}
