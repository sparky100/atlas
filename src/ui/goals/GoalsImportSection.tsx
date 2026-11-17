/**
 * "Import goals" on the Import page, for owners and architects only. A goal is
 * not a fact and has no review step, so this is not the capture importer: the
 * person picks a sheet, sees exactly what will be added, and applies it
 * directly. Only ever adds; an existing title is skipped. The database (RLS and
 * triggers) is the real gate (ADR-035).
 */
import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { getMainBranch } from '../../db/branches';
import { listCapabilitiesForMap } from '../../db/capabilityMap';
import { createGoal, linkCapabilityToGoal, listGoalsForModel } from '../../db/goals';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { countText } from './goalModel';
import { parseGoalsRows, planGoalsImport, PROBLEM_WORDS, summarisePlan, type PlannedGoal } from './goalsImport';
import { downloadGoalsTemplate, readGoalsSheet } from './goalsImportXlsx';
import styles from '../import/ImportHelpers.module.css';

const PARSE_MESSAGE = {
  'no-heading': 'Atlas could not find a Title column. Download the blank goals sheet to see the columns it reads.',
  'no-rows': 'That sheet has a heading row but no goals under it.',
  'too-many': 'That file has too many goals for one import (200 at most). Split it and import it in parts.',
} as const;

export function GoalsImportSection({ modelId, orgId, userId, goalsHref }: { modelId: UUID; orgId: UUID; userId: UUID | null; goalsHref: string }) {
  const inputId = useId();
  const [plan, setPlan] = useState<PlannedGoal[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function choose(file: File | undefined): Promise<void> {
    setPlan(null);
    setMessage(null);
    setDone(null);
    if (!file) return;
    setBusy(true);
    try {
      const parsed = parseGoalsRows(await readGoalsSheet(file));
      if (!parsed.ok) {
        setMessage(PARSE_MESSAGE[parsed.reason]);
        return;
      }
      const main = await getMainBranch(supabase, modelId);
      const [existing, capabilities] = await Promise.all([listGoalsForModel(supabase, modelId), main?.head_commit_id ? listCapabilitiesForMap(supabase, main.head_commit_id) : Promise.resolve([])]);
      setPlan(planGoalsImport(parsed.rows, existing, capabilities));
    } catch (e) {
      setMessage("Couldn't read that file. Use an .xlsx or .csv file.");
      reportError("Couldn't read the goals file.", e);
    } finally {
      setBusy(false);
    }
  }

  async function apply(): Promise<void> {
    if (!plan || !userId) return;
    const toAdd = plan.filter((p) => p.status === 'new' && p.input !== null);
    setBusy(true);
    setMessage(null);
    let added = 0;
    try {
      for (const item of toAdd) {
        if (!item.input) continue;
        const goalId = crypto.randomUUID();
        await createGoal(supabase, { id: goalId, orgId, modelId, ...item.input, createdBy: userId });
        added += 1;
        for (const capabilityId of item.capabilityIds) await linkCapabilityToGoal(supabase, { goalId, capabilityId, createdBy: userId });
      }
      setDone(`Added ${countText(added, 'goal', 'goals')}.`);
      setPlan(null);
    } catch (e) {
      setMessage(`Stopped after adding ${countText(added, 'goal', 'goals')}. Check Goals, then import the file again: goals already added are skipped.`);
      setPlan(null);
      reportError("Couldn't finish importing goals.", e);
    } finally {
      setBusy(false);
    }
  }

  const summary = plan ? summarisePlan(plan) : null;
  const problems = plan?.filter((p) => p.status === 'invalid') ?? [];

  return (
    <div role="group" aria-label="Import goals" className={styles.compact}>
      <Text as="h3" size="md">
        Import goals
      </Text>
      <Text as="p" size="sm" tone="muted">
        Add goals from a spreadsheet: a title, what success looks like, and optionally why now and the capabilities that serve it. You see what will be added first, and nothing existing is changed. Goals are not part of the landscape, so there is no review step.
      </Text>
      <div className={styles.actions}>
        <label htmlFor={inputId}>
          <Text as="span" size="sm">
            Goals file (.xlsx or .csv)
          </Text>
        </label>
        <input
          id={inputId}
          type="file"
          accept=".xlsx,.csv"
          disabled={busy}
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button variant="ghost" onClick={downloadGoalsTemplate}>
          Download a blank goals sheet
        </Button>
      </div>
      {message && (
        <div role="alert"><Text as="p" size="sm">
          {message}
        </Text></div>
      )}
      {done && (
        <div role="status"><Text as="p" size="sm">
          {done} <Link to={goalsHref}>See them on Goals</Link>
        </Text></div>
      )}
      {plan && summary && (
        <div>
          <div role="status"><Text as="p" size="sm">
            {summary.add === 0 ? 'Nothing new to add.' : `Ready to add ${countText(summary.add, 'goal', 'goals')}.`}
            {summary.exists > 0 && ` ${countText(summary.exists, 'goal is', 'goals are')} already in the model and will be skipped.`}
            {summary.repeated > 0 && ` ${countText(summary.repeated, 'row repeats', 'rows repeat')} a title earlier in the file and will be skipped.`}
            {summary.unmatched > 0 && ` ${countText(summary.unmatched, 'capability name matches', 'capability names match')} no single capability and will be left unlinked.`}
          </Text></div>
          <ul>
            {plan
              .filter((p) => p.status === 'new')
              .map((p) => (
                <li key={p.rowNumber}>
                  <Text as="span" size="sm">
                    {p.title}: serves {countText(p.capabilityIds.length, 'capability', 'capabilities')}
                    {p.unmatchedCapabilityNames.length > 0 && ` (not found: ${p.unmatchedCapabilityNames.join(', ')})`}
                  </Text>
                </li>
              ))}
            {problems.map((p) => (
              <li key={p.rowNumber}>
                <Text as="span" size="sm">
                  Row {p.rowNumber} {p.problem ? PROBLEM_WORDS[p.problem] : 'cannot be read'} and will be skipped.
                </Text>
              </li>
            ))}
          </ul>
          <Button
            variant="primary"
            disabled={busy || summary.add === 0}
            onClick={() => {
              void apply();
            }}
          >
            {summary.add === 0 ? 'Add goals' : `Add ${countText(summary.add, 'goal', 'goals')}`}
          </Button>
        </div>
      )}
    </div>
  );
}
