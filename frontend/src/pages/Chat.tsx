import { BookOpen, Send } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type SyntheticEvent } from 'react';

import { useActiveOrder, useChatHistory, useOrder, useSendChat } from '../api/hooks';
import type { ChatMessage } from '../api/types';
import { useUser } from '../auth/AuthProvider';
import { MutationError, PageHeader, QueryBoundary } from '../components/ui';

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

function Bubble({ message }: { message: Pick<ChatMessage, 'role' | 'message' | 'source_reference'> }) {
  const mine = message.role === 'user';
  return (
    <li className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-2xl border-2 border-ink px-4 py-3 ${mine ? 'bg-ink text-light' : 'bg-light'}`}>
        <p className={`label mb-1.5 ${mine ? 'text-light' : ''}`}>{mine ? 'You' : 'Assistant'}</p>
        <p className="whitespace-pre-wrap text-lg leading-relaxed">
          <RichText text={message.message} />
        </p>
        {message.source_reference && (
          <p className="mt-3 flex items-center gap-2 border-t-2 border-ink pt-2 text-sm">
            <BookOpen size={16} aria-hidden="true" />
            <span className="font-semibold">{message.source_reference}</span>
          </p>
        )}
      </div>
    </li>
  );
}

function prompts(company: string | undefined): { topic: string; items: string[] }[] {
  return [
    {
      topic: 'Procedures',
      items: [
        company ? `What's the SOP for ${company}?` : 'What are the standard procedures?',
        'What do I do with a damaged pallet?',
        'How do I handle a paperwork mismatch?',
      ],
    },
    {
      topic: 'Temperature',
      items: [
        'What are the temperature thresholds?',
        "What if the reefer isn't running?",
        'Temp is borderline — what do I do?',
      ],
    },
    {
      topic: 'Locations',
      items: [
        'Where are the slip sheets?',
        "Where's the scanner charging station?",
        "Where's the damage quarantine area?",
      ],
    },
    {
      topic: 'Safety and systems',
      items: ['Someone was hurt at my dock', 'The WMS is offline', 'Barcode won’t scan — help'],
    },
  ];
}

export default function Chat() {
  const user = useUser();
  const history = useChatHistory();
  const active = useActiveOrder();
  const order = useOrder(user.role === 'operator' ? active.data?.id : undefined);
  const send = useSendChat();
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const company = active.data?.company_name;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [history.data, pending]);

  const ask = (text: string) => {
    const message = text.trim();
    if (!message || send.isPending) return;
    setInput('');
    setPending(message);
    send.mutate(
      {
        message,
        company_id: active.data?.company_id ?? null,
        product_category: order.data?.items[0]?.category ?? null,
      },
      { onSettled: () => setPending(null) },
    );
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    ask(input);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker={company ? `Knows your ${company} order` : 'SOPs, procedures, locations'}
        title="Assistant"
      />

      <QueryBoundary query={history} loading="Loading the conversation">
        {(messages) =>
          messages.length === 0 && !pending ? (
            <div className="grid gap-4 md:grid-cols-2">
              {prompts(company).map((group) => (
                <section key={group.topic} className="border-2 border-ink bg-light">
                  <h2 className="heading border-b-2 border-ink px-4 py-2 text-lg">{group.topic}</h2>
                  <ul>
                    {group.items.map((prompt) => (
                      <li key={prompt}>
                        <button
                          type="button"
                          onClick={() => ask(prompt)}
                          className="w-full border-b border-hairline px-4 py-3 text-left text-base font-semibold hover:bg-paper-sunk"
                        >
                          {prompt}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <ul className="flex flex-col gap-3" aria-live="polite">
              {messages.map((message) => (
                <Bubble key={message.id} message={message} />
              ))}
              {pending && (
                <>
                  <Bubble message={{ role: 'user', message: pending, source_reference: null }} />
                  <li className="label">Assistant is answering…</li>
                </>
              )}
            </ul>
          )
        }
      </QueryBoundary>
      <div ref={bottom} />

      <form
        onSubmit={submit}
        className="sticky bottom-20 z-10 flex gap-2 border-2 border-ink bg-paper p-2 lg:bottom-4"
      >
        <label htmlFor="chat-input" className="sr-only">
          Ask the assistant
        </label>
        <input
          id="chat-input"
          className="field text-lg"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={company ? `Ask about ${company}, procedures, locations…` : 'Ask anything…'}
          autoComplete="off"
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!input.trim() || send.isPending}
          aria-label="Send"
        >
          <Send size={20} aria-hidden="true" />
        </button>
      </form>
      <MutationError error={send.error} />
      <p className="text-sm text-ink-mute">
        Answers come from company SOPs and the knowledge base. Confirm anything food-safety critical with your
        supervisor.
      </p>
    </div>
  );
}
