import { useCallback, useRef, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { askModel, AskModelError, type AskModelOutcome } from '../../db/askModel';
import type { AskTurn } from '../../tools/askLoop';
import { loadBrowserEnv } from '../env';
import { supabase } from '../supabaseClient';

export interface AskStep {
  name: string;
  /** `null` while the lookup is still running. */
  ok: boolean | null;
}

export type AskTurnState =
  | { id: number; question: string; status: 'asking'; steps: AskStep[] }
  | { id: number; question: string; status: 'answered'; steps: AskStep[]; outcome: Extract<AskModelOutcome, { status: 'done' }> }
  | { id: number; question: string; status: 'refused'; steps: AskStep[]; reason: 'disabled' | 'not_found' | 'empty_model' | 'invalid'; message: string }
  | { id: number; question: string; status: 'failed'; steps: AskStep[]; code: 'rate_limited' | 'provider' | 'failed'; message: string };

export interface UseAskAtlasResult {
  turns: AskTurnState[];
  busy: boolean;
  ask: (question: string) => Promise<void>;
  clear: () => void;
}

/**
 * ADR-028 §7: the conversation lives in memory only. Reloading the page, or
 * `clear`, drops it; nothing is stored on the server.
 */
export function useAskAtlas(modelId: UUID | null): UseAskAtlasResult {
  const [turns, setTurns] = useState<AskTurnState[]>([]);
  const nextId = useRef(1);
  const turnsRef = useRef<AskTurnState[]>([]);
  const busy = turns.some((t) => t.status === 'asking');

  const replace = useCallback((id: number, update: (turn: AskTurnState) => AskTurnState) => {
    turnsRef.current = turnsRef.current.map((t) => (t.id === id ? update(t) : t));
    setTurns(turnsRef.current);
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!modelId || trimmed === '' || turnsRef.current.some((t) => t.status === 'asking')) return;
      const history: AskTurn[] = turnsRef.current.flatMap((t) => (t.status === 'answered' ? [{ role: 'user' as const, text: t.question }, { role: 'assistant' as const, text: t.outcome.result.answer }] : []));
      const id = nextId.current++;
      turnsRef.current = [...turnsRef.current, { id, question: trimmed, status: 'asking', steps: [] }];
      setTurns(turnsRef.current);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new AskModelError('failed', 'You need to be signed in to ask a question.');
        const outcome = await askModel({
          functionUrl: `${loadBrowserEnv().VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/ask-model`,
          accessToken: session.access_token,
          modelId,
          question: trimmed,
          history,
          onEvent: (event) => {
            replace(id, (t) => {
              const steps = t.steps.slice();
              if (event.type === 'tool_call') steps.push({ name: event.name, ok: null });
              else {
                let open = -1;
                steps.forEach((s, i) => {
                  if (s.name === event.name && s.ok === null) open = i;
                });
                if (open >= 0) steps[open] = { name: event.name, ok: event.ok };
              }
              return { ...t, steps };
            });
          },
        });
        replace(id, (t) => {
          if (outcome.status === 'done') return { id, question: t.question, status: 'answered', steps: t.steps, outcome };
          const message = outcome.status === 'invalid' ? outcome.message : '';
          return { id, question: t.question, status: 'refused', steps: t.steps, reason: outcome.status, message };
        });
      } catch (e) {
        const code = e instanceof AskModelError ? e.code : 'failed';
        replace(id, (t) => ({ id, question: t.question, status: 'failed', steps: t.steps, code, message: e instanceof Error ? e.message : 'Something went wrong.' }));
      }
    },
    [modelId, replace],
  );

  const clear = useCallback(() => {
    turnsRef.current = [];
    setTurns([]);
  }, []);

  return { turns, busy, ask, clear };
}
