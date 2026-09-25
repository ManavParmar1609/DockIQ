import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

function Frame({ code, title, children }: { code: string; title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-xl card">
        <div className="hazard-tape h-3" aria-hidden="true" />
        <div className="p-6">
          <p className="label mb-2">{code}</p>
          <h1 className="display text-4xl">{title}</h1>
          <div className="mt-4 text-lg text-ink-soft">{children}</div>
          <div className="mt-6 flex gap-2">
            <Link to="/app" className="btn btn-primary">
              Back to work
            </Link>
            <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Per-route error boundary: a crash in one screen never blanks the whole app. */
export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  const message = error instanceof Error ? error.message : 'Unknown error';
  return (
    <Frame code="Screen error" title="This screen failed">
      <p>The rest of DockIQ still works. Go back, or reload to try again.</p>
      <p className="telemetry mt-3 text-sm text-ink-mute">{message}</p>
    </Frame>
  );
}

export function NotFound() {
  return (
    <Frame code="404" title="No such screen">
      <p>That address does not lead anywhere in DockIQ.</p>
    </Frame>
  );
}
