import { Check, Wrench, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useActiveOrder, useCreateRequest, useTaxonomy } from '../api/hooks';
import { MutationError } from '../components/ui';

/** An operator's one-tap request for equipment or supplies, sent to their supervisor. */
export function QuickRequest() {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const taxonomy = useTaxonomy();
  const order = useActiveOrder();
  const request = useCreateRequest();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const close = () => {
    setOpen(false);
    request.reset();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-primary fixed right-4 bottom-24 z-30 px-4 shadow-float sm:px-5 lg:right-6 lg:bottom-6"
        aria-haspopup="dialog"
        aria-label="Quick request"
      >
        <Wrench size={20} aria-hidden="true" />
        <span className="hidden sm:inline">Request</span>
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
              <p className="text-ink-soft">{request.variables.request_type} — your supervisor has it.</p>
              <button type="button" className="btn btn-secondary mt-2" onClick={close}>
                Done
              </button>
            </div>
          ) : (
            <>
              <p className="mb-4 text-ink-soft">Tap what you need. Your supervisor is notified at once.</p>
              <div className="grid grid-cols-2 gap-2">
                {(taxonomy.data?.request_types ?? []).map((type) => (
                  <button
                    key={type}
                    type="button"
                    disabled={request.isPending}
                    className="choice min-h-20"
                    onClick={() =>
                      request.mutate({ request_type: type, dock_door_id: order.data?.dock_door_id ?? null })
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
        </div>
      </dialog>
    </>
  );
}
