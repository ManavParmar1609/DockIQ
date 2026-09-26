import { CloudOff, RotateCw, X } from 'lucide-react';

import { useOfflineReports } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';

function Queue({ userId }: { userId: number }) {
  const { waiting, refused, retry, dismiss } = useOfflineReports(userId);
  if (waiting === 0 && refused.length === 0) return null;
  return (
    <div className="mb-6 flex flex-col gap-2">
      {waiting > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl bg-paper-sunk p-3 pl-4">
          <CloudOff size={20} aria-hidden="true" className="shrink-0 text-ink-mute" />
          <p className="flex-1 text-base">
            <span className="telemetry mr-1">{waiting}</span>
            {waiting === 1 ? 'report' : 'reports'} waiting to send. Kept on this tablet; sent when the
            connection is back.
          </p>
          <button type="button" className="btn btn-secondary" onClick={retry}>
            <RotateCw size={18} aria-hidden="true" /> Send now
          </button>
        </div>
      )}
      {refused.map((report) => (
        <div
          key={report.key}
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl bg-paper-sunk p-3 pl-4"
        >
          <p className="flex-1 text-base">
            <span className="heading mr-1.5">Not filed: {report.title}.</span>
            {report.reason} Report it again.
          </p>
          <button
            type="button"
            className="grid h-11 w-11 place-items-center rounded-full text-ink-mute hover:bg-paper"
            aria-label="Dismiss"
            onClick={() => dismiss(report.key)}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Reports kept on the tablet while it was offline (`api/offline.ts`): how many wait, and a retry. */
export function OfflineReports() {
  const { user } = useAuth();
  if (!user || user.role !== 'operator') return null;
  return <Queue userId={user.id} />;
}
