import { CheckCheck } from 'lucide-react';
import { useEffect } from 'react';

import { useMarkHandoffRead } from '../api/hooks';
import type { Handoff } from '../api/types';
import { useUser } from '../auth/AuthProvider';
import { formatDateTime } from '../lib/format';

/** Who read it, and when — or that nobody has yet. */
export function ReadReceipt({ handoff }: { handoff: Handoff }) {
  if (handoff.read_at) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-ink-mute">
        <CheckCheck size={16} aria-hidden="true" />
        Read by {handoff.read_by_name ?? 'the incoming supervisor'} at {formatDateTime(handoff.read_at)}
      </p>
    );
  }
  return <p className="text-sm text-ink-mute">Not read yet</p>;
}

/**
 * A handoff note as the incoming supervisor sees it. Showing it to a supervisor who did not write it
 * records the read receipt (the first reader stands; your own note is never "read").
 */
export function HandoffNote({ handoff }: { handoff: Handoff }) {
  const user = useUser();
  const markRead = useMarkHandoffRead();
  const { mutate } = markRead;
  const incoming = user.role === 'supervisor' && handoff.supervisor_id !== user.id && !handoff.read_at;

  useEffect(() => {
    if (incoming) mutate(handoff.id);
  }, [handoff.id, incoming, mutate]);

  return (
    <div className="flex flex-col gap-2">
      <p className="label">
        {handoff.supervisor_name} · {handoff.shift} shift · {formatDateTime(handoff.created_at)}
      </p>
      <p className="text-base whitespace-pre-line">{handoff.notes}</p>
      <ReadReceipt handoff={handoff} />
    </div>
  );
}
