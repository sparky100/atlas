import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { MAX_CHANGE_BRIEF_CHARS } from '../../contracts/capture';
import type { UUID } from '../../contracts/delta';
import { isCreatingJob, useCaptureJobs } from '../capture/useCaptureJob';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { BriefSlotPicker } from './BriefSlotPicker';
import {
  CHANGE_BRIEF_TEMPLATES,
  missingBriefSlots,
  renderBrief,
  renderBriefText,
  type BriefSlotValues,
  type ChangeBriefTemplate,
} from './changeBriefTemplates';
import styles from './ChangesView.module.css';
import draftStyles from './DraftWithAi.module.css';

interface DraftWithAiProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID;
  basePath: string;
  elementName?: string;
  /**
   * Main's head commit. When given, the starting-point pills are offered and
   * their blanks are picked from the model. Without it (a system's own page,
   * where the system is already fixed) there is just the single button.
   */
  commitId?: UUID | null;
  /** Lets the page hide its own manual form while this one is open. */
  onOpenChange?: (open: boolean) => void;
}

export function DraftWithAi({ modelId, orgId, userId, basePath, elementName, commitId = null, onOpenChange }: DraftWithAiProps) {
  const navigate = useNavigate();
  const { createJob, status, error } = useCaptureJobs(modelId, orgId, userId, false);
  const [open, setOpenState] = useState(false);
  const [template, setTemplate] = useState<ChangeBriefTemplate | null>(null);
  const [values, setValues] = useState<BriefSlotValues>({});
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [briefEdited, setBriefEdited] = useState(false);
  const submitting = useRef(false);
  const busy = isCreatingJob(status);
  const context = elementName ? `System in scope: ${elementName}\n\n` : '';
  const limit = Math.max(0, MAX_CHANGE_BRIEF_CHARS - context.length);
  const validTitle = title.trim() !== '';
  const missing = template && !briefEdited ? missingBriefSlots(template, values) : [];

  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  const start = (chosen: ChangeBriefTemplate | null) => {
    setTemplate(chosen);
    setValues({});
    setTitleEdited(false);
    setBriefEdited(false);
    setTitle(chosen ? renderBriefText(chosen.title, chosen.slots, {}) : '');
    setBrief(chosen ? renderBrief(chosen, {}) : '');
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setTemplate(null);
    setValues({});
    setTitle('');
    setBrief('');
  };

  const setSlot = (key: string, name: string) => {
    if (!template) return;
    const next: BriefSlotValues = { ...values, [key]: { name } };
    setValues(next);
    if (!titleEdited) setTitle(renderBriefText(template.title, template.slots, next));
    if (!briefEdited) setBrief(renderBrief(template, next));
  };

  if (!open) {
    if (commitId === null) return <Button onClick={() => { start(null); }}>Draft with AI</Button>;
    return (
      <section className={draftStyles.block} aria-label="Draft with AI">
        <Text as="p" size="sm">
          Draft with AI: start from a common change and Atlas suggests the edits for you to review. Or fill in the form below yourself.
        </Text>
        <div className={draftStyles.pills} role="group" aria-label="Common changes">
          {CHANGE_BRIEF_TEMPLATES.map((t) => (
            <button key={t.id} type="button" className={draftStyles.pill} onClick={() => { start(t); }}>
              {t.pill}
            </button>
          ))}
          <button type="button" className={draftStyles.pill} onClick={() => { start(null); }}>
            Describe your own
          </button>
        </div>
      </section>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (submitting.current || !validTitle || brief.trim() === '' || brief.length > limit || missing.length > 0) return;
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
      {template && commitId !== null && (
        <>
          <Text as="p" size="sm">
            <strong>{template.pill}</strong>
          </Text>
          {template.slots.map((slot) => (
            <BriefSlotPicker
              key={slot.key}
              slot={slot}
              value={values[slot.key]?.name ?? ''}
              onChange={(name) => { setSlot(slot.key, name); }}
              commitId={commitId}
              modelId={modelId}
              disabled={busy}
            />
          ))}
          {template.note && (
            <Text as="p" tone="muted" size="sm">
              {template.note}
            </Text>
          )}
        </>
      )}
      <label>
        Change title
        <input
          className={styles.input}
          value={title}
          maxLength={100}
          required
          disabled={busy}
          onChange={(event) => {
            setTitleEdited(true);
            setTitle(event.target.value);
          }}
        />
      </label>
      <label>
        Change brief
        <textarea
          className={styles.textarea}
          value={brief}
          maxLength={limit}
          rows={4}
          required
          disabled={busy}
          onChange={(event) => {
            setBriefEdited(true);
            setBrief(event.target.value);
          }}
        />
      </label>
      {missing.length > 0 && (
        <Text as="p" tone="muted" size="sm">
          Still to fill in: {missing.join(', ')}.
        </Text>
      )}
      <div className={styles.formRow}>
        <Button type="submit" variant="primary" disabled={busy || !validTitle || brief.trim() === '' || missing.length > 0}>
          {busy ? 'Starting draft…' : 'Generate draft'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={close}>Cancel</Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
