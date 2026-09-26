import { ArrowUpRight, BookOpen, Check, CircleAlert, LoaderCircle, Send, Warehouse } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';

import { useAssistant, type Exchange, type Step } from '../api/assistant';
import { useActiveOrder, useChatHistory, useOrder } from '../api/hooks';
import type { ChatMessage, Role } from '../api/types';
import { useUser } from '../auth/AuthProvider';
import { AgentActionView, AgentCardView } from '../components/AssistantCards';
import { VoiceButton } from '../components/Evidence';
import { Inline, RichAnswer } from '../components/RichAnswer';
import { PageHeader, QueryBoundary } from '../components/ui';

function Question({ text }: { text: string }) {
  return (
    <li className="flex justify-end">
      <p className="bubble-user">{text}</p>
    </li>
  );
}

function Mark() {
  return (
    <span className="turn-mark" aria-hidden="true">
      <Warehouse size={18} strokeWidth={2.2} />
    </span>
  );
}

/** One assistant turn: the DockIQ mark in a gutter, the answer beside it, the source underneath. */
function Turn({
  source,
  busy,
  live,
  children,
}: {
  source?: string | null;
  busy?: boolean;
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="turn" aria-live={live ? 'polite' : undefined} aria-busy={busy}>
      <Mark />
      <div className="flex min-w-0 flex-col gap-3">
        <p className="turn-name">DockIQ</p>
        {children}
        {source && (
          <p className="label flex items-center gap-1.5">
            <BookOpen size={14} aria-hidden="true" />
            {source}
          </p>
        )}
      </div>
    </li>
  );
}

/** A past turn from history: text only. */
function PastAnswer({ message }: { message: ChatMessage }) {
  return (
    <Turn source={message.source_reference}>
      <RichAnswer text={message.message} />
    </Turn>
  );
}

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="trace" aria-label="What the assistant checked">
      {steps.map((step, index) => (
        <li key={`${step.tool}-${String(index)}`} className="flex items-start gap-2">
          {step.state === 'running' ? (
            <LoaderCircle
              size={16}
              aria-label="Working"
              className="mt-0.5 shrink-0 text-sage-ink motion-safe:animate-spin"
            />
          ) : step.state === 'done' ? (
            <Check size={16} aria-label="Done" className="mt-0.5 shrink-0 text-sage-ink" />
          ) : (
            <CircleAlert size={16} aria-label="Could not" className="mt-0.5 shrink-0 text-hazard" />
          )}
          <span>
            <span className="font-semibold text-ink">{step.label}</span>
            {step.summary && (
              <>
                {' · '}
                <Inline text={step.summary} />
              </>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Answer({ exchange }: { exchange: Exchange }) {
  const waiting = exchange.status === 'streaming' && exchange.steps.length === 0 && !exchange.text;
  return (
    <Turn
      live
      busy={exchange.status === 'streaming'}
      source={exchange.status === 'done' ? exchange.source : null}
    >
      {exchange.steps.length > 0 && <StepList steps={exchange.steps} />}
      {waiting && <p className="label">Reading your question…</p>}
      {exchange.cards.map((card, index) => (
        <AgentCardView key={`${card.kind}-${String(index)}`} card={card} />
      ))}
      {exchange.text && <RichAnswer text={exchange.text.trim()} />}
      {exchange.actions.map((action, index) => (
        <AgentActionView key={`${action.kind}-${String(index)}`} action={action} />
      ))}
      {exchange.error && (
        <p role="alert" className="rounded-lg bg-hazard-soft p-3 text-base font-semibold text-hazard-deep">
          {exchange.error}
        </p>
      )}
    </Turn>
  );
}

function suggestions(role: Role, sku: string | undefined): string[] {
  switch (role) {
    case 'operator':
      return [
        "What's next at my dock?",
        'Probe reads 3°F',
        sku ? `Where is ${sku} stored?` : 'Where are the slip sheets?',
        'Pallet crushed on one side, about 6 cases. Report it',
        'How do I handle a seal that does not match the BOL?',
        'Where are the slip sheets?',
      ];
    case 'supervisor':
      return [
        'What needs me right now?',
        'How is the shift going?',
        'Draft the handoff note',
        'Tell the team to re-probe every frozen load before unloading',
        'Which carrier is causing the most problems?',
      ];
    case 'quality':
      return [
        'What quality issues are open?',
        'How is the shift going?',
        'How do I handle a temperature excursion?',
      ];
  }
}

/** Who makes the call, by role: a supervisor is never told to ask their supervisor. */
const FOOTER: Record<Role, string> = {
  operator: 'Confirm anything food-safety critical with your supervisor.',
  supervisor: 'Food-safety decisions are yours: check the SOP it cites and the readings before you decide.',
  quality:
    'Cold-chain and disposition decisions stay with Quality: check the cited SOP and the probe log first.',
};

const INTRO: Record<Role, string> = {
  operator: 'Checks your order, temperatures and stock. Drafts reports for you to file.',
  supervisor: 'Knows your team’s queue. Drafts broadcasts and handoffs for you to send.',
  quality: 'Knows every open quality issue and the cold-chain rules.',
};

export default function Chat() {
  const user = useUser();
  const history = useChatHistory();
  const active = useActiveOrder();
  const order = useOrder(user.role === 'operator' ? active.data?.id : undefined);
  const { exchanges, ask, busy } = useAssistant();
  const [input, setInput] = useState('');
  const [openedAt] = useState(() => Date.now());
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  const latest = exchanges.at(-1);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [exchanges.length, latest?.steps.length, latest?.cards.length, latest?.actions.length]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    setInput('');
    ask(text);
  };
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    send(input);
  };

  const chips = [...new Set(suggestions(user.role, order.data?.items[0]?.sku))];
  const started =
    exchanges.length > 0 ||
    (history.data?.some((message) => Date.parse(message.created_at) < openedAt) ?? false);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={
          user.role === 'operator' && active.data
            ? `On ${active.data.order_number} · ${active.data.company_name}`
            : 'Your assistant'
        }
        title="Ask DockIQ"
        meta={<span>{INTRO[user.role]}</span>}
      />

      <QueryBoundary query={history} loading="Loading the conversation">
        {(messages) => {
          const earlier = messages.filter((message) => Date.parse(message.created_at) < openedAt).slice(-10);
          return earlier.length === 0 && exchanges.length === 0 ? (
            <section className="flex flex-col gap-6" aria-labelledby="chat-start">
              <div className="turn">
                <Mark />
                <div className="min-w-0">
                  <h2 id="chat-start" className="display text-3xl">
                    Ask the way you would ask a lead.
                  </h2>
                  <p className="mt-3 max-w-2xl text-lg text-ink-soft">
                    Type or dictate. It checks your live data first and shows what it checked. Anything it
                    prepares, a report or a message, waits for you to press the button.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {chips.slice(0, 4).map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="starter"
                    disabled={busy}
                    onClick={() => send(chip)}
                  >
                    <span>{chip}</span>
                    <ArrowUpRight size={18} aria-hidden="true" className="shrink-0 text-accent-ink" />
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <ul className="flex flex-col gap-8">
              {earlier.map((message) =>
                message.role === 'user' ? (
                  <Question key={message.id} text={message.message} />
                ) : (
                  <PastAnswer key={message.id} message={message} />
                ),
              )}
              {exchanges.map((exchange) => (
                <Fragment key={exchange.id}>
                  <Question text={exchange.question} />
                  <Answer exchange={exchange} />
                </Fragment>
              ))}
            </ul>
          );
        }}
      </QueryBoundary>
      <div ref={bottom} />

      <div className="composer sticky bottom-20 z-10 flex flex-col gap-2 p-2 lg:bottom-4">
        {started && (
          <div className="chip-rail flex gap-2 overflow-x-auto" aria-label="Suggestions">
            {chips.map((chip) => (
              <button
                key={chip}
                type="button"
                className="chip-suggest shrink-0 text-sm disabled:opacity-60"
                disabled={busy}
                onClick={() => send(chip)}
              >
                {chip}
              </button>
            ))}
          </div>
        )}
        {/* Below sm, Dictate and Send sit under the input so the box keeps its width on a phone. */}
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="chat-input" className="sr-only">
            Ask the assistant
          </label>
          <input
            id="chat-input"
            ref={field}
            className="field-bare"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask, or tap Dictate…"
            autoComplete="off"
            maxLength={2000}
          />
          <div className="flex justify-end gap-2">
            {/* Dictation fills the box for the worker to read back and send: a mis-heard word is not a question. */}
            <VoiceButton
              onText={(text) => {
                setInput((current) => (current ? `${current} ${text}` : text).slice(0, 2000));
                field.current?.focus();
              }}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!input.trim() || busy}
              aria-label="Send"
            >
              <Send size={20} aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>
      <p className="label">
        Figures come from DockIQ&apos;s rules and your records. Severity is never decided by the assistant.{' '}
        {FOOTER[user.role]}
      </p>
    </div>
  );
}
