import { formatDate } from '../lib/format';

interface StoredPallet {
  pallet_id: string;
  location: string;
  cases: number;
  lot: string;
  best_before: string;
}

/** Pallets on hand, first-expiring first: the top one is the one to pick. */
export function PalletList({ pallets }: { pallets: readonly StoredPallet[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {pallets.map((pallet, index) => (
        <li
          key={pallet.pallet_id}
          className={`rounded-md px-3 py-2 ${index === 0 ? 'bg-surface ring-2 ring-ink' : 'bg-paper'}`}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="telemetry text-lg">{pallet.location}</span>
            {index === 0 && <span className="label text-ink">Pick first</span>}
          </div>
          <p className="telemetry text-sm text-ink-mute">
            {pallet.cases} cs · lot {pallet.lot} · best before {formatDate(pallet.best_before)}
          </p>
        </li>
      ))}
    </ul>
  );
}
