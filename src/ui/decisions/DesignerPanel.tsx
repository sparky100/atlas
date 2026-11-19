import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { runDesigner, type DesignerDraft } from '../../db/designAgent';
import { designerCostLine } from './designerRequest';
import { supabase } from '../supabaseClient';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import styles from './DecisionsView.module.css';

export interface DesignerPanelProps {
  modelId: UUID;
  input: { elementId: UUID; finding: string };
  /** Put the (edited) draft into the decision's context. The person still starts the decision themselves. `edited` is true when the person changed the Designer's draft first, so the decision can say so. */
  onUse: (text: string, info: { edited: boolean; draftedAt: string }) => void;
}

/**
 * Phase D step 2b: "Draft options with the Designer". Runs the agent on the
 * finding behind this form and shows its draft in a box the person can edit.
 * The draft is only text: it writes nothing, and nothing is recorded until the
 * person starts the decision. It uses the organisation's own AI key.
 */
export function DesignerPanel({ modelId, input, onUse }: DesignerPanelProps) {
  const [state, setState] = useState<'idle' | 'running' | 'failed' | 'drafted'>('idle');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState('');
  const [original, setOriginal] = useState('');
  const [draftedAt, setDraftedAt] = useState('');
  const [meta, setMeta] = useState<Pick<DesignerDraft, 'citedNames' | 'grounded' | 'usage'> | null>(null);

  async function run() {
    setState('running');
    setMessage('');
    try {
      const result = await runDesigner(supabase, { modelId, ...input });
      setDraft(result.text);
      setOriginal(result.text);
      setDraftedAt(new Date().toISOString());
      setMeta({ citedNames: result.citedNames, grounded: result.grounded, usage: result.usage });
      setState('drafted');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'The Designer could not draft options. Try again.');
      setState('failed');
    }
  }

  return (
    <div data-testid="designer-panel">
      <Button type="button" variant="secondary" disabled={state === 'running'} onClick={() => { void run(); }}>
        {state === 'running' ? 'Drafting options…' : state === 'drafted' ? 'Draft again' : 'Draft options with the Designer'}
      </Button>
      <Text as="p" tone="muted" size="sm">
        The Designer reads what Atlas holds about this and drafts a short set of options, always including staying as we are. It is a draft to edit, not a recommendation, and it changes nothing. It runs on your organisation's AI key.
      </Text>
      {state === 'failed' && (
        <div role="alert">
          <Text as="p">{message}</Text>
        </div>
      )}
      {state === 'drafted' && (
        <div>
          <label htmlFor="designer-draft">
            <Text as="span" size="sm">
              Designer's draft (edit before you use it)
            </Text>
          </label>
          <textarea
            id="designer-draft"
            className={styles.textarea}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
          />
          <Text as="p" tone="muted" size="sm">
            {meta?.grounded === true ? `Based on: ${meta.citedNames.join(', ')}.` : 'Not tied to specific records Atlas holds, so check it carefully.'}
          </Text>
          {meta !== null && (
            <div data-testid="designer-cost">
              <Text as="p" tone="muted" size="sm">
                {designerCostLine(meta.usage)}
              </Text>
            </div>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={draft.trim() === ''}
            onClick={() => {
              onUse(draft.trim(), { edited: draft.trim() !== original.trim(), draftedAt });
            }}
          >
            Add to the context above
          </Button>
        </div>
      )}
    </div>
  );
}
