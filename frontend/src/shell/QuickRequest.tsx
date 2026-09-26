import { Check, Clock, Wrench, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useActiveOrder, useCreateRequest, useMyRequests, useTaxonomy } from '../api/hooks';
import type { QuickRequest as Request } from '../api/types';
import { FieldLabel, MutationError, QueryBoundary, Tag } from '../components/ui';
import { timeAgo } from '../lib/format';

const SHOWN = 5;

/** The operator's own requests, newest first; `new_request` events keep the statuses live. */
function MyRequests({ requests }: { requests: Request[] }) {
  if (requests.length === 0) return null;
  return (
    <section aria-labelledby="my-requests-title" className="mt-5 border-t border-hairline pt-4">
      <h3 id="my-requests-title" className="heading text-lg">
        My requests
      </h3>
      <ul className="mt-2 flex flex-col">
        {requests.slice(0, SHOWN).map((request) => (
          <li
            key={request.id}
            className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 last:border-b-0"
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold">{request.request_type}</span>
              <span className="telemetry text-sm text-ink-mute">
                {request.door_number == null ? 'No dock' : `Dock ${String(request.door_number)}`} ·{' '}
                {timeAgo(request.fulfilled_at ?? request.created_at)}
              </span>
            </span>
            {request.status === 'fulfilled' ? (
              <Tag tone="green">
                <Check size={14} strokeWidth={3} aria-hidden="true" /> Done
              </Tag>
            ) : (
              <Tag>
                <Clock size={14} aria-hidden="true" /> Waiting
              </Tag>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** An operator's one-tap request for equipment or supplies, sent to their supervisor. */
export function QuickRequest() {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const taxonomy = useTaxonomy();
  const order = useActiveOrder();
  const request = useCreateRequest();
  const mine = useMyRequests();
  const waiting = (mine.data ?? []).filter((item) => item.status === 'pending').length;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const close = () => {
    setOpen(false);
    setDetails('');
    request.reset();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-primary fixed right-4 bottom-24 z-30 px-4 shadow-float sm:px-5 lg:right-6 lg:bottom-6"
        aria-haspopup="dialog"
        aria-label={waiting > 0 ? `Quick request, ${String(waiting)} waiting` : 'Quick request'}
      >
        <Wrench size={20} aria-hidden="true" />
        <span className="hidden sm:inline">Request</span>
        {waiting > 0 && <span className="telemetry">· {waiting}</span>}
      </button>

      <dialog
        ref={dialog}
        onClose={close}
        aria-labelledby="quick-request-title"
        className="sheet m-auto rounded-2xl bg-surface p-0 text-ink shadow-float"
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 id="quick-request-title" className="heading text-xl">
            Quick request
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid h-11 w-11 place-items-center rounded-full bg-paper-sunk text-ink-mute"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="p-5">
          {request.isSuccess ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-green-soft text-green">
                <Check size={34} strokeWidth={2.5} aria-hidden="true" />
              </span>
              <p className="heading text-2xl">Request sent</p>
              <p className="text-ink-soft">
                {request.variables.request_type} — your supervisor has it. You will see here when it is done.
              </p>
              <button type="button" className="btn btn-secondary mt-2" onClick={close}>
                Done
              </button>
            </div>
          ) : (
            <>
              <p className="mb-4 text-ink-soft">Tap what you need. Your supervisor is notified at once.</p>
              <div className="mb-4">
                <FieldLabel htmlFor="request-details" hint="Optional">
                  A note for your supervisor
                </FieldLabel>
                <input
                  id="request-details"
                  className="field"
                  maxLength={200}
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  placeholder="e.g. the left forks are bent"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(taxonomy.data?.request_types ?? []).map((type) => (
                  <button
                    key={type}
                    type="button"
                    disabled={request.isPending}
                    className="choice min-h-20"
                    onClick={() =>
                      request.mutate({
                        request_type: type,
                        dock_door_id: order.data?.dock_door_id ?? null,
                        ...(details.trim() ? { details: details.trim() } : {}),
                      })
                    }
                  >
                    {type}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <MutationError error={request.error} />
              </div>
            </>
          )}
          <QueryBoundary query={mine} loading="Loading your requests">
            {(list) => <MyRequests requests={list} />}
          </QueryBoundary>
        </div>
      </dialog>
    </>
  );
}
