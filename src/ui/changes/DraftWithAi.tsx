import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { MAX_CHANGE_BRIEF_CHARS } from '../../contracts/capture';
import type { UUID } from '../../contracts/delta';
import { isCreatingJob, useCaptureJobs } from '../capture/useCaptureJob';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import styles from './ChangesView.module.css';

interface DraftWithAiProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID;
  basePath: string;
  elementName?: string;
}

export function DraftWithAi({ modelId, orgId, userId, basePath, elementName }: DraftWithAiProps) {
  const navigate = useNavigate();
  const { createJob, status, error } = useCaptureJobs(modelId, orgId, userId, false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const submitting = useRef(false);
  const busy = isCreatingJob(status);
  const context = elementName ? `System in scope: ${elementName}\n\n` : '';
  const limit = Math.max(0, MAX_CHANGE_BRIEF_CHARS - context.length);
  const validTitle = title.trim() !== '';

  if (!open) return <Button onClick={() => { setOpen(true); }}>Draft with AI</Button>;

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (submitting.current || !validTitle || brief.trim() === '' || brief.length > limit) return;
        submitting.current = true;
        void createJob({
          inputKind: 'change_brief',
          inputName: title.trim(),
          bytes: new TextEncoder().encode(context + brief.trim()),
          documentDate: null,
          reimportOfJobId: null,
        }).then((job) => {
          submitting.current = false;
          if (job) void navigate(`${basePath}/review/capture/${job.id}`);
        });
      }}
    >
      <Text as="p" size="sm">Describe a future change. Atlas will suggest edits for you to review.</Text>
      {elementName && <Text as="p" size="sm">System in scope: {elementName}</Text>}
      <label>
        Change title
        <input className={styles.input} value={title} maxLength={100} required disabled={busy} onChange={(event) => { setTitle(event.target.value); }} />
      </label>
      <label>
        Change brief
        <textarea className={styles.textarea} value={brief} maxLength={limit} rows={4} required disabled={busy} onChange={(event) => { setBrief(event.target.value); }} />
      </label>
      <div className={styles.formRow}>
        <Button type="submit" variant="primary" disabled={busy || !validTitle || brief.trim() === ''}>
          {busy ? 'Starting draft…' : 'Generate draft'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => { setOpen(false); }}>Cancel</Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
