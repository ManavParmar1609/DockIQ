/** A link into the report flow with fields pre-filled from where the problem was found. */
export interface ReportPrefill {
  type?: string;
  subtype?: string;
  description?: string;
  temp?: number;
  limit?: number;
  expected?: number;
  actual?: number;
}

export function reportLink(prefill: ReportPrefill): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(prefill)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `/app/report?${query}` : '/app/report';
}

export function readPrefill(search: URLSearchParams): ReportPrefill {
  const number = (key: string) => {
    const raw = search.get(key);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isNaN(value) ? undefined : value;
  };
  return {
    type: search.get('type') ?? undefined,
    subtype: search.get('subtype') ?? undefined,
    description: search.get('description') ?? undefined,
    temp: number('temp'),
    limit: number('limit'),
    expected: number('expected'),
    actual: number('actual'),
  };
}
