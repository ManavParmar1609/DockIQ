import { BookOpen, Check, CircleAlert, LoaderCircle, Send } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type SyntheticEvent } from 'react';

import { useAssistant, type Exchange, type Step } from '../api/assistant';
import { useActiveOrder, useChatHistory, useOrder } from '../api/hooks';
import type { ChatMessage, Role } from '../api/types';
import { useUser } from '../auth/AuthProvider';
import { AgentActionView, AgentCardView } from '../components/AssistantCards';
import { VoiceButton } from '../components/Evidence';
import { PageHeader, QueryBoundary } from '../components/ui';

/** Only **bold** is interpreted. Model output is text to display, never HTML (security rules §4). */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={index} className="font-extrabold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function Question({ text }: { text: string }) {
  return (
    <li className="flex justify-end">
      <p className="max-w-2xl rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-lg text-white">{text}</p>
    </li>
  );
}

function Source({ source }: { source: string }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      <BookOpen size={16} aria-hidden="true" />
      <span className="font-semibold">{source}</span>
    </p>
  );
}

/** A past turn from history: text only. */
function PastAnswer({ message }: { message: ChatMessage }) {
  return (
    <li className="flex justify-start">
      <div className="max-w-2xl card px-4 py-3">
        <p className="whitespace-pre-wrap text-lg leading-relaxed">
          <RichText text={message.message} />
        </p>
        {message.source_reference && (
          <div className="mt-3 border-t border-hairline pt-2">
            <Source source={message.source_reference} />
          </div>
        )}
      </div>
    </li>
  );
}

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-col gap-1" aria-label="What the assistant checked">
      {steps.map((step, index) => (
        <li key={`${step.tool}-${String(index)}`} className="flex items-start gap-2 text-base">
          {step.state === 'running' ? (
            <LoaderCircle
              size={18}
              aria-label="Working"
              className="mt-0.5 shrink-0 motion-safe:animate-spin"
            />
          ) : step.state === 'done' ? (
            <Check size={18} aria-label="Done" className="mt-0.5 shrink-0" />
          ) : (
            <CircleAlert size={18} aria-label="Could not" className="mt-0.5 shrink-0" />
          )}
          <span>
            <span className="font-semibold">{step.label}</span>
            {step.summary && <span className="text-ink-soft"> · {step.summary}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Answer({ exchange }: { exchange: Exchange }) {
  const waiting = exchange.status === 'streaming' && exchange.steps.length === 0 && !exchange.text;
  return (
    <li className="flex flex-col gap-3 border-l-4 border-ink pl-4">
      {exchange.steps.length > 0 && <StepList steps={exchange.steps} />}
      {waiting && <p className="label">Reading your question…</p>}
      {exchange.cards.map((card, index) => (
        <AgentCardView key={`${card.kind}-${String(index)}`} card={card} />
      ))}
      {exchange.text && (
        <p className="max-w-3xl whitespace-pre-wrap text-lg leading-relaxed">
          <RichText text={exchange.text.trim()} />
        </p>
      )}
      {exchange.actions.map((action, index) => (
        <AgentActionView key={`${action.kind}-${String(index)}`} action={action} />
      ))}
      {exchange.error && (
        <p role="alert" className="rounded-lg bg-hazard-soft p-3 text-base font-semibold text-hazard-deep">
          {exchange.error}
        </p>
      )}
      {exchange.status === 'done' && exchange.source && <Source source={exchange.source} />}
    </li>
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

  return (
    <div className="flex flex-col gap-6">
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
            <div className="card p-6">
              <p className="heading text-xl">Ask the way you would ask a lead.</p>
              <p className="mt-2 max-w-2xl text-base text-ink-soft">
                Type or dictate. It checks your live data first and shows what it checked. Anything it
                prepares, a report or a message, waits for you to press the button.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-5">
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

      <div className="material-thick sticky bottom-20 z-10 flex flex-col gap-2 rounded-2xl p-2 shadow-float lg:bottom-4">
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Suggestions">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              className="shrink-0 card px-3 text-base font-semibold hover:bg-paper-sunk disabled:opacity-60"
              disabled={busy}
              onClick={() => send(chip)}
            >
              {chip}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Ask the assistant
          </label>
          <input
            id="chat-input"
            className="field text-lg"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask, or tap Dictate…"
            autoComplete="off"
            maxLength={2000}
          />
          <VoiceButton onText={(text) => send(text)} />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!input.trim() || busy}
            aria-label="Send"
          >
            <Send size={20} aria-hidden="true" />
          </button>
        </form>
      </div>
      <p className="text-sm text-ink-mute">
        Figures come from DockIQ&apos;s rules and your records. Severity is never decided by the assistant.
        Confirm anything food-safety critical with your supervisor.
      </p>
    </div>
  );
}
