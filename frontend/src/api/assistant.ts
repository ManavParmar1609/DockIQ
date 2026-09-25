/**
 * The assistant's live exchanges. The server streams what the agent does (steps), what it found
 * (cards — the tool's own numbers), drafts it prepared (actions), and its words (text). Past turns
 * come from /api/chat/history as text (the page shows those from before it opened); exchanges from
 * this visit keep their cards and drafts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { errorMessage, postEventStream } from './client';
import type { components } from './schema.gen';

type Schemas = components['schemas'];
export type AgentCard = NonNullable<Schemas['ChatReply']['cards']>[number];
export type AgentAction = NonNullable<Schemas['ChatReply']['actions']>[number];
export type IssueDraft = Schemas['IssueDraft'];
export type BroadcastDraft = Schemas['BroadcastDraft'];
export type HandoffDraft = Schemas['HandoffDraft'];

export interface Step {
  tool: string;
  label: string;
  state: 'running' | 'done' | 'failed';
  summary?: string;
}

export interface Exchange {
  id: number;
  question: string;
  steps: Step[];
  cards: AgentCard[];
  actions: AgentAction[];
  text: string;
  source: string | null;
  status: 'streaming' | 'done' | 'failed';
  error: string | null;
}

type StreamEvent =
  | { type: 'step'; tool: string; label: string; state: Step['state']; summary?: string }
  | { type: 'card'; card: AgentCard }
  | { type: 'action'; action: AgentAction }
  | { type: 'delta'; text: string }
  | { type: 'source'; source: string; confidence: string }
  | { type: 'done'; message_id: number; source: string; confidence: string }
  | { type: 'error'; message: string };

function isEvent(value: unknown): value is StreamEvent {
  return (
    typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
  );
}

function apply(exchange: Exchange, event: StreamEvent): Exchange {
  switch (event.type) {
    case 'step': {
      const step: Step = { tool: event.tool, label: event.label, state: event.state, summary: event.summary };
      // A running step is replaced by its result: the last running step of that tool.
      const index = exchange.steps.findLastIndex((s) => s.tool === event.tool && s.state === 'running');
      const steps =
        event.state !== 'running' && index !== -1
          ? exchange.steps.map((s, i) => (i === index ? step : s))
          : [...exchange.steps, step];
      return { ...exchange, steps };
    }
    case 'card':
      return { ...exchange, cards: [...exchange.cards, event.card] };
    case 'action':
      return { ...exchange, actions: [...exchange.actions, event.action] };
    case 'delta':
      return { ...exchange, text: exchange.text + event.text };
    case 'source':
      return { ...exchange, source: event.source };
    case 'done':
      return { ...exchange, status: 'done', source: exchange.source ?? event.source };
    case 'error':
      return { ...exchange, status: 'failed', error: event.message };
  }
}

export function useAssistant() {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const abort = useRef<AbortController | null>(null);
  const serial = useRef(0);

  useEffect(() => () => abort.current?.abort(), []);

  const busy = exchanges.some((exchange) => exchange.status === 'streaming');

  const ask = useCallback(
    (question: string) => {
      const text = question.trim();
      if (!text || busy) return;
      serial.current += 1;
      const id = serial.current;
      const update = (change: (exchange: Exchange) => Exchange) => {
        setExchanges((list) => list.map((exchange) => (exchange.id === id ? change(exchange) : exchange)));
      };
      setExchanges((list) => [
        ...list,
        {
          id,
          question: text,
          steps: [],
          cards: [],
          actions: [],
          text: '',
          source: null,
          status: 'streaming',
          error: null,
        },
      ]);
      const controller = new AbortController();
      abort.current = controller;
      postEventStream(
        '/api/chat/stream',
        { message: text },
        (event) => {
          if (isEvent(event)) update((exchange) => apply(exchange, event));
        },
        controller.signal,
      )
        .then(() => {
          // A stream that ended without `done` still ends: never leave the page "answering" forever.
          update((exchange) =>
            exchange.status === 'streaming' ? { ...exchange, status: 'done' } : exchange,
          );
        })
        .catch((error: unknown) => {
          update((exchange) => ({ ...exchange, status: 'failed', error: errorMessage(error) }));
        });
    },
    [busy],
  );

  return { exchanges, ask, busy };
}
