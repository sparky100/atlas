/**
 * F2 (full K1) PR14: the capture upload dialog — file or pasted text,
 * document date, and the re-import picker (SPEC-capture.md §9.3). The
 * `capture_jobs` row's own creation, the Storage upload, and invoking
 * `capture-run` all happen through `createJob` (`useCaptureJob.ts`), owned
 * by the caller (`CaptureJobListView.tsx`) so the dialog and the list it
 * sits above always agree on the same live state — this dialog itself
 * holds only its own form fields.
 *
 * No review queue exists yet (PR15) — closing this dialog after a
 * successful create leaves the reviewer on the job list, watching the new
 * row's status poll forward, rather than navigating anywhere.
 */
import { useEffect, useMemo, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { CaptureInputKind, CaptureJob } from '../../contracts/capture';
import { prepareMulesoftUpload } from '../../capture/adapters/mulesoftUpload';
import { DEFAULT_IMPORT_SOURCE, IMPORT_SOURCE_GROUP_LABELS, IMPORT_SOURCES, importSourceById, type ImportSourceId } from '../../capture/importSources';
import { listExternalRefMappings } from '../../db/aliases';
import { computeInputSha256Hex, findReimportCandidate } from '../../db/captureJobs';
import { findConnector, listConnectors, runConnector } from '../../db/connectors';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { downloadMulesoftExportScript } from '../import/downloadMulesoftExportScript';
import { supabase } from '../supabaseClient';
import { isCreatingJob, type CreateCaptureJobInput, type CaptureJobsStatus } from './useCaptureJob';
import styles from './UploadCaptureDialog.module.css';

export interface UploadCaptureDialogProps {
  open: boolean;
  onClose: () => void;
  modelId: UUID;
  createJob: (input: CreateCaptureJobInput) => Promise<CaptureJob | null>;
  status: CaptureJobsStatus;
  error: string | null;
}

/** K-16's own upload limits (SPEC-capture.md line 30) — only the two checkable client-side without parsing the document; row/page counts are enforced server-side during `parse` and surface as `capture_jobs.error` afterwards instead. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_PASTED_TEXT_CHARS = 200_000;

type Mode = 'file' | 'paste';
/** Renders a guide step, turning `backticked` text into <code>. */
function GuideStep({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part))}
    </>
  );
}

interface SelectedInput {
  inputKind: CaptureInputKind;
  inputName: string;
  bytes: Uint8Array;
}

function inputKindForFilename(filename: string): CaptureInputKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.xlsx') || lower.endsWith('.json')) return 'spreadsheet';
  if (lower.endsWith('.pdf')) return 'pdf';
  return null;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadCaptureDialog({ open, onClose, modelId, createJob, status, error }: UploadCaptureDialogProps) {
  const [mode, setMode] = useState<Mode>('file');
  const [pastedText, setPastedText] = useState('');
  const [pasteName, setPasteName] = useState('');
  const [fileSelection, setFileSelection] = useState<SelectedInput | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [source, setSource] = useState<ImportSourceId>(DEFAULT_IMPORT_SOURCE);
  const [mulesoftFile, setMulesoftFile] = useState<{ name: string; text: string } | null>(null);
  const [aliasText, setAliasText] = useState('');
  // A saved MuleSoft connection (Organisation settings → Connections) lets this dialog fetch the export itself instead of taking a file. Only owners and architects can read connections, so for anyone else this stays null and the file path is all they see.
  const [mulesoftConnection, setMulesoftConnection] = useState<{ orgId: UUID } | null>(null);
  const [fetchState, setFetchState] = useState<{ status: 'idle' | 'fetching' } | { status: 'error'; message: string }>({ status: 'idle' });
  // The model's own saved hostnames (external references on element pages); a failed load just means only typed mappings apply.
  const [savedAliases, setSavedAliases] = useState<Record<string, string>>({});
  const [documentDate, setDocumentDate] = useState('');
  const [documentDateTouched, setDocumentDateTouched] = useState(false);
  // Keyed by `inputName` rather than reset imperatively when there's
  // nothing to look up — `reimportCandidate` below derives the value that
  // actually applies to *this* render's `selected`, so switching files/
  // modes never needs its own explicit "clear the old lookup" setState
  // call (react-hooks/set-state-in-effect: only this effect's own
  // `.then()`/`.catch()` callbacks ever call `setReimportLookup`).
  const [reimportLookup, setReimportLookup] = useState<{ inputName: string; job: CaptureJob | null } | null>(null);
  const [useReimport, setUseReimport] = useState(true);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || source !== 'mulesoft') return;
    let cancelled = false;
    listExternalRefMappings(supabase, modelId)
      .then((mappings) => {
        if (!cancelled) setSavedAliases(mappings);
      })
      .catch((e: unknown) => {
        console.error('could not load saved hostname mappings', e);
      });
    return () => {
      cancelled = true;
    };
  }, [open, source, modelId]);

  useEffect(() => {
    if (!open || source !== 'mulesoft') return;
    const live = { cancelled: false };
    void (async () => {
      try {
        const { data } = await supabase.from('models').select('org_id').eq('id', modelId).maybeSingle();
        const orgId = (data as { org_id?: UUID } | null)?.org_id;
        if (orgId === undefined) return;
        const rows = await listConnectors(supabase, orgId);
        if (!live.cancelled) setMulesoftConnection(findConnector(rows, 'mulesoft') !== null ? { orgId } : null);
      } catch (e) {
        console.error('could not check for a MuleSoft connection', e);
      }
    })();
    return () => {
      live.cancelled = true;
    };
  }, [open, source, modelId]);

  // §9.2: pasted text is stored as an object too. Its name is the user's own
  // (falling back to `pasted-text.txt` when left blank) so a later re-import
  // can find it by the same name. Purely derived from `pastedText`/`pasteName`
  // — a `useMemo`, not a `useState`+`useEffect` pair, since there's no
  // external system involved here at all.
  const pasteSelection = useMemo((): { selected: SelectedInput | null; error: string | null } => {
    if (pastedText.trim().length === 0) return { selected: null, error: null };
    if (pastedText.length > MAX_PASTED_TEXT_CHARS) {
      return { selected: null, error: `Pasted text is ${pastedText.length.toLocaleString()} characters — the limit is ${MAX_PASTED_TEXT_CHARS.toLocaleString()}.` };
    }
    return { selected: { inputKind: 'text', inputName: pasteName.trim() !== '' ? pasteName.trim() : 'pasted-text.txt', bytes: new TextEncoder().encode(pastedText) }, error: null };
  }, [pastedText, pasteName]);

  // The converted import JSON is what the run stores and re-imports — derived, never copied into state, so editing the mappings re-converts the same file.
  const mulesoftPrepared = useMemo(() => (mulesoftFile === null ? null : prepareMulesoftUpload({ fileName: mulesoftFile.name, text: mulesoftFile.text, aliasText, savedAliases })), [mulesoftFile, aliasText, savedAliases]);
  const mulesoftSelection = useMemo((): SelectedInput | null => (mulesoftPrepared?.ok === true ? { inputKind: 'spreadsheet', inputName: mulesoftPrepared.inputName, bytes: mulesoftPrepared.bytes } : null), [mulesoftPrepared]);

  const selected = source === 'mulesoft' ? mulesoftSelection : mode === 'file' ? fileSelection : pasteSelection.selected;
  const localError = source === 'mulesoft' ? (fileError ?? (mulesoftPrepared?.ok === false ? mulesoftPrepared.error : null)) : mode === 'file' ? fileError : pasteSelection.error;

  useEffect(() => {
    const inputName = selected?.inputName ?? null;
    if (inputName === null) return;
    let cancelled = false;
    findReimportCandidate(supabase, modelId, inputName)
      .then((job) => {
        if (cancelled) return;
        setReimportLookup({ inputName, job });
        setUseReimport(true);
      })
      .catch(() => {
        // A failed lookup just means no re-import default is offered — not
        // worth blocking the upload over, and `createJob` itself still
        // reports any real failure through the global error banner.
        if (!cancelled) setReimportLookup({ inputName, job: null });
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, selected]);

  const reimportCandidate = selected !== null && reimportLookup !== null && reimportLookup.inputName === selected.inputName ? reimportLookup.job : null;

  // Hashing a multi-megabyte file used to run synchronously inside this
  // `useMemo`, as part of the very render `setFileSelection`/`setPastedText`
  // triggers — nothing (not even the file input showing a selection, or the
  // Start button becoming enabled) could paint until that hash finished, no
  // matter how long it took. An effect instead lets the "file selected"
  // render commit and paint first, with `computeInputSha256Hex`'s own
  // `crypto.subtle` hash (non-blocking by construction) running after.
  // Keyed by `selected` itself, same "derive, don't imperatively reset"
  // shape `reimportLookup`/`reimportCandidate` above already use — this
  // never calls `setState` for the "nothing selected"/"selection changed"
  // case, only once the hash of *this* `selected` actually resolves.
  const [hashLookup, setHashLookup] = useState<{ selected: SelectedInput; hex: string } | null>(null);
  useEffect(() => {
    if (!selected) return undefined;
    let cancelled = false;
    void computeInputSha256Hex(selected.bytes).then((hex) => {
      if (!cancelled) setHashLookup({ selected, hex });
    });
    return () => {
      cancelled = true;
    };
  }, [selected]);
  const selectedSha256Hex = selected !== null && hashLookup !== null && hashLookup.selected === selected ? hashLookup.hex : null;
  const hashing = selected !== null && selectedSha256Hex === null;
  const isIdenticalToReimportCandidate = reimportCandidate !== null && selectedSha256Hex !== null && selectedSha256Hex === reimportCandidate.inputSha256;

  const resetForm = () => {
    setMode('file');
    setPastedText('');
    setPasteName('');
    setFileSelection(null);
    setFileError(null);
    setSource(DEFAULT_IMPORT_SOURCE);
    setMulesoftFile(null);
    setAliasText('');
    setDocumentDate('');
    setDocumentDateTouched(false);
    setReimportLookup(null);
    setUseReimport(true);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  if (!open) return null;

  const onFileChange = (file: File) => {
    const kind = inputKindForFilename(file.name);
    if (!kind) {
      setFileSelection(null);
      setFileError(`"${file.name}" isn't a .csv, .xlsx, .json, or .pdf file.`);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setFileSelection(null);
      setFileError(`"${file.name}" is ${formatMegabytes(file.size)} — the limit is ${formatMegabytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    void file.arrayBuffer().then((buffer) => {
      setFileError(null);
      setFileSelection({ inputKind: kind, inputName: file.name, bytes: new Uint8Array(buffer) });
      if (!documentDateTouched && file.lastModified) {
        setDocumentDate(new Date(file.lastModified).toISOString().slice(0, 10));
      }
    });
  };

  const fetchFromMulesoft = (orgId: UUID) => {
    setFetchState({ status: 'fetching' });
    void runConnector(supabase, orgId, 'mulesoft', 'fetch').then((result) => {
      if (result.status === 'ok' && result.mode === 'fetch') {
        setFetchState({ status: 'idle' });
        setFileError(null);
        setMulesoftFile({ name: result.fileName, text: result.text });
      } else {
        setFetchState({ status: 'error', message: result.status === 'error' ? result.message : 'Unexpected answer from the connection.' });
      }
    });
  };

  const onMulesoftFileChange = (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      setMulesoftFile(null);
      setFileError(`"${file.name}" is ${formatMegabytes(file.size)} — the limit is ${formatMegabytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    void file.text().then((text) => {
      setFileError(null);
      setMulesoftFile({ name: file.name, text });
      if (!documentDateTouched && file.lastModified) {
        setDocumentDate(new Date(file.lastModified).toISOString().slice(0, 10));
      }
    });
  };

  const switchSource = (next: ImportSourceId) => {
    setSource(next);
    setFileSelection(null);
    setFileError(null);
    setMulesoftFile(null);
    setPastedText('');
  };

  const canSubmit = selected !== null && localError === null && !isCreatingJob(status);

  const onSubmit = () => {
    if (!selected) return;
    void createJob({
      inputKind: selected.inputKind,
      inputName: selected.inputName,
      bytes: selected.bytes,
      documentDate: documentDate.trim().length > 0 ? documentDate.trim() : null,
      reimportOfJobId: useReimport && reimportCandidate ? reimportCandidate.id : null,
      // Already computed by the effect above whenever it's finished in time
      // — `undefined` (still hashing, or nothing to reuse) just means
      // `createJob` computes it itself rather than submit waiting on it.
      inputSha256Hex: selectedSha256Hex ?? undefined,
    }).then((job) => {
      if (job) handleClose();
    });
  };

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Start an import">
        <Panel raised>
          <div className={styles.panel}>
            <div className={styles.header}>
              <Text as="h2" size="lg">
                Start an import
              </Text>
              <Button variant="ghost" aria-label="Close" onClick={handleClose}>
                ✕
              </Button>
            </div>
            <Text as="p" tone="muted" size="sm">
              {importSourceById(source).intro}
            </Text>

            <div className={styles.sources} role="radiogroup" aria-label="What are you importing?">
              {(['documents', 'tool-export'] as const).map((group) => (
                <div key={group} className={styles.sourceGroup}>
                  <Text as="span" size="sm" tone="muted">
                    {IMPORT_SOURCE_GROUP_LABELS[group]}
                  </Text>
                  <div className={styles.sourceCards}>
                    {IMPORT_SOURCES.filter((candidate) => candidate.group === group).map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        role="radio"
                        aria-checked={source === candidate.id}
                        className={[styles.sourceCard, source === candidate.id ? styles.sourceCardSelected : ''].filter(Boolean).join(' ')}
                        disabled={isCreatingJob(status)}
                        onClick={() => {
                          switchSource(candidate.id);
                        }}
                      >
                        <Text as="span" size="sm">
                          {candidate.title}
                        </Text>
                        <Text as="span" size="sm" tone="muted">
                          {candidate.summary}
                        </Text>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {source === 'documents' && (
            <div className={styles.modeToggle}>
              <Button variant={mode === 'file' ? 'secondary' : 'ghost'} aria-pressed={mode === 'file'} onClick={() => { setMode('file'); setPastedText(''); }}>
                Upload a file
              </Button>
              <Button variant={mode === 'paste' ? 'secondary' : 'ghost'} aria-pressed={mode === 'paste'} onClick={() => { setMode('paste'); setFileSelection(null); setFileError(null); }}>
                Paste text
              </Button>
            </div>
            )}

            <div className={styles.form}>
              {source === 'mulesoft' && (
                <>
                  <ol className={styles.guide}>
                    {importSourceById('mulesoft').exportSteps.map((step) => (
                      <li key={step}>
                        <Text as="span" size="sm">
                          <GuideStep text={step} />
                        </Text>
                      </li>
                    ))}
                  </ol>
                  {mulesoftConnection !== null && (
                    <div className={styles.formRow}>
                      <Text as="p" size="sm">
                        This organisation has a MuleSoft connection, so you can fetch the export directly instead of using the script and a file.
                      </Text>
                      <div className={styles.actions}>
                        <Button variant="primary" disabled={fetchState.status === 'fetching' || isCreatingJob(status)} onClick={() => { fetchFromMulesoft(mulesoftConnection.orgId); }}>
                          {fetchState.status === 'fetching' ? 'Fetching from MuleSoft…' : 'Fetch from MuleSoft'}
                        </Button>
                      </div>
                      {fetchState.status === 'error' && (
                        <div role="alert">
                          <Text as="p" size="sm">
                            Problem: {fetchState.message}
                          </Text>
                        </div>
                      )}
                      <Text as="p" size="sm" tone="muted">
                        Or use a file, as below.
                      </Text>
                    </div>
                  )}
                  {mulesoftConnection === null && (
                    <Text as="p" size="sm" tone="muted">
                      An owner can connect MuleSoft in Organisation settings (Connections), so this step becomes one button.
                    </Text>
                  )}
                  <div className={styles.actions}>
                    <Button variant="secondary" onClick={downloadMulesoftExportScript}>
                      Download the export script
                    </Button>
                  </div>
                  <input
                    className={styles.input}
                    type="file"
                    accept=".json"
                    aria-label="Choose the MuleSoft export file"
                    disabled={isCreatingJob(status)}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onMulesoftFileChange(file);
                    }}
                  />
                  <div className={styles.formRow}>
                    <Text as="label" size="sm" tone="muted">
                      Backend systems (optional): one per line, hostname = Atlas system name
                      {Object.keys(savedAliases).length > 0 ? `. ${String(Object.keys(savedAliases).length)} saved on element pages already apply; a line here overrides one.` : ''}
                    </Text>
                    <textarea
                      className={styles.textarea}
                      placeholder="mprs.example.com = MPRS"
                      aria-label="Backend hostname mappings"
                      value={aliasText}
                      disabled={isCreatingJob(status)}
                      onChange={(e) => {
                        setAliasText(e.target.value);
                      }}
                    />
                  </div>
                  {mulesoftPrepared?.ok === true && (
                    <div className={styles.formRow} aria-label="What this export contains">
                      <Text as="p" size="sm">
                        {mulesoftPrepared.summary}
                      </Text>
                      {mulesoftPrepared.warnings.length > 0 && (
                        <ul className={styles.warnings}>
                          {mulesoftPrepared.warnings.map((warning) => (
                            <li key={warning}>
                              <Text as="span" size="sm" tone="muted">
                                {warning}
                              </Text>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
              {source === 'documents' && mode === 'file' ? (
                <input
                  className={styles.input}
                  type="file"
                  accept=".csv,.xlsx,.json,.pdf"
                  aria-label="Choose a CSV, XLSX, JSON, or PDF file"
                  disabled={isCreatingJob(status)}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onFileChange(file);
                  }}
                />
              ) : null}
              {(source === 'mulesoft' || mode === 'file') && hashing && (
                <Text as="p" tone="muted" size="sm">
                  Reading {selected.inputName}…
                </Text>
              )}
              {source === 'documents' && mode === 'paste' ? (
                <textarea
                  className={styles.textarea}
                  placeholder="Paste meeting notes, an email, or any other free text describing systems, owners, or relationships…"
                  aria-label="Pasted text"
                  value={pastedText}
                  disabled={isCreatingJob(status)}
                  onChange={(e) => {
                    setPastedText(e.target.value);
                  }}
                />
              ) : null}

              {source === 'documents' && mode === 'paste' && (
                <div className={styles.formRow}>
                  <Text as="label" size="sm" tone="muted">
                    Name (optional)
                  </Text>
                  <input
                    className={styles.input}
                    placeholder="pasted-text.txt"
                    aria-label="Name for this pasted text"
                    value={pasteName}
                    disabled={isCreatingJob(status)}
                    onChange={(e) => {
                      setPasteName(e.target.value);
                    }}
                  />
                </div>
              )}

              <div className={styles.formRow}>
                <Text as="label" size="sm" tone="muted">
                  Document date (optional)
                </Text>
                <input
                  className={styles.input}
                  type="date"
                  value={documentDate}
                  disabled={isCreatingJob(status)}
                  onChange={(e) => {
                    setDocumentDateTouched(true);
                    setDocumentDate(e.target.value);
                  }}
                />
              </div>

              {reimportCandidate && (
                <div className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    id="use-reimport"
                    checked={useReimport}
                    disabled={isCreatingJob(status)}
                    onChange={(e) => {
                      setUseReimport(e.target.checked);
                    }}
                  />
                  <Text as="label" size="sm">
                    This replaces the previous import of &ldquo;{reimportCandidate.inputName}&rdquo; from {reimportCandidate.createdAt.slice(0, 10)}.
                    {isIdenticalToReimportCandidate && ' It looks identical to that import — nothing may have changed since then.'}
                  </Text>
                </div>
              )}

              {localError !== null && (
                <Text as="p" size="sm">
                  {localError}
                </Text>
              )}
              {error !== null && (
                <Text as="p" size="sm">
                  {error}
                </Text>
              )}

              <div className={styles.actions}>
                <Button variant="primary" disabled={!canSubmit} onClick={onSubmit}>
                  {status === 'uploading' ? 'Uploading…' : status === 'saving' ? 'Saving…' : 'Start import'}
                </Button>
                <Button variant="ghost" disabled={isCreatingJob(status)} onClick={handleClose}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
