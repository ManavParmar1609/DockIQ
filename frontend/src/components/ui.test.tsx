import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { ChoiceGroup, QueryBoundary } from './ui';

/** Render a QueryBoundary over a query whose successive fetches give `answers` in turn. */
function renderBoundary(answers: (() => Promise<string>)[]): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let call = 0;
  const queryFn = () => {
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    return answer ? answer() : Promise.reject(new Error('no answer'));
  };
  function Boundary() {
    const query = useQuery({ queryKey: ['boundary'], queryFn });
    return <QueryBoundary query={query}>{(data) => <p>{data}</p>}</QueryBoundary>;
  }
  render(
    <QueryClientProvider client={client}>
      <Boundary />
    </QueryClientProvider>,
  );
  return client;
}

const offline = () => Promise.reject(new Error('The server could not be reached.'));

describe('QueryBoundary', () => {
  it('keeps the last good data on screen when a refetch fails, with a retry', async () => {
    const client = renderBoundary([() => Promise.resolve('Dock 4 loading'), offline]);
    expect(await screen.findByText('Dock 4 loading')).toBeInTheDocument();

    await act(() => client.refetchQueries({ queryKey: ['boundary'] }));
    expect(await screen.findByText(/Could not refresh/)).toBeInTheDocument();
    expect(screen.getByText('Dock 4 loading')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });

  it('shows the error block when there is no data to fall back on', async () => {
    renderBoundary([offline]);
    expect(await screen.findByText('Could not load this')).toBeInTheDocument();
  });
});

describe('ChoiceGroup', () => {
  const OPTIONS = [
    { value: 'intact', label: 'Intact' },
    { value: 'broken', label: 'Broken' },
    { value: 'missing', label: 'Missing' },
  ] as const;

  function Seal() {
    const [value, setValue] = useState<(typeof OPTIONS)[number]['value'] | null>(null);
    return <ChoiceGroup label="Seal" options={OPTIONS} value={value} onChange={setValue} />;
  }

  it('is one tab stop, and the arrow keys move the selection', async () => {
    const user = userEvent.setup();
    render(<Seal />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Intact' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    const broken = screen.getByRole('radio', { name: 'Broken' });
    expect(broken).toBeChecked();
    expect(broken).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Intact' })).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Missing' })).toBeChecked();
  });
});
