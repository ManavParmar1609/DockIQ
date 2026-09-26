import { CloudOff, Thermometer, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { ApiError } from '../../api/client';
import {
  useColdRooms,
  useCrewProductivity,
  useGateLog,
  useLedger,
  useShipments,
  useStock,
  useWarehouseTasks,
} from '../../api/hooks';
import type {
  ColdRoom,
  GateEvent,
  LedgerEntry,
  RoomCode,
  Shipment,
  StockRow,
  WarehouseTask,
} from '../../api/types';
import { Tabs } from '../../components/Tabs';
import {
  ChoiceGroup,
  Definition,
  EmptyState,
  Panel,
  QueryBoundary,
  SimulatedTag,
  Stat,
  StatGrid,
  Tag,
} from '../../components/ui';
import { duration, formatDate, formatNumber, formatTemp } from '../../lib/format';

type View = 'yard' | 'inventory' | 'tasks' | 'rooms' | 'ledger';

const VIEWS: readonly { id: View; label: string }[] = [
  { id: 'yard', label: 'Yard' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'rooms', label: 'Cold rooms' },
  { id: 'ledger', label: 'Transactions' },
];

const PANEL_ID = 'warehouse-view';

const ROOMS: readonly { value: RoomCode; label: string }[] = [
  { value: 'F', label: 'Freezer' },
  { value: 'C', label: 'Cooler' },
  { value: 'P', label: 'Produce' },
  { value: 'D', label: 'Dry' },
];

const SHIPMENT_STATUS: Record<Shipment['status'], string> = {
  expected: 'ASN received',
  arrived: 'At the gate',
  receiving: 'Receiving',
  received: 'Received',
  released: 'Picking',
  staged: 'Staged',
  loading: 'Loading',
  shipped: 'Shipped',
  cancelled: 'Cancelled',
};

const GATE_KIND: Record<GateEvent['kind'], string> = {
  gate_in: 'Check-in',
  yard_move: 'To door',
  gate_out: 'Check-out',
};

const TASK_KIND: Record<WarehouseTask['kind'], string> = {
  putaway: 'Put-away',
  pick: 'Pick',
  replenish: 'Replenish',
  cycle_count: 'Cycle count',
};

const TASK_STATUS: Record<WarehouseTask['status'], string> = {
  open: 'Queued',
  assigned: 'Working',
  done: 'Done',
  cancelled: 'Cancelled',
};

const MOVEMENT: Record<LedgerEntry['kind'], string> = {
  receive: 'Receive',
  putaway: 'Put-away',
  replenish: 'Replenish',
  pick: 'Pick',
  load: 'Load',
  ship: 'Ship',
  adjust: 'Adjust',
  hold: 'Quality hold',
  release: 'Release',
};

const AREA: Record<string, string> = {
  storage: 'Racking',
  hold: 'Quality hold',
  dock: 'Dock lane',
  stage: 'Staging',
  trailer: 'On trailer',
};

function down(online: boolean, error: Error | null): boolean {
  return !online || (error instanceof ApiError && error.status === 503);
}

function Offline() {
  return (
    <div className="p-4">
      <EmptyState title="WMS offline" icon={<CloudOff size={28} aria-hidden="true" />}>
        The warehouse view comes back with the WMS. Work carries on meanwhile.
      </EmptyState>
    </div>
  );
}

const PAGE = 20;

/** Shows the first rows of a long list and lets the reader ask for more, twenty at a time. */
function useFirst<T>(rows: readonly T[]): { shown: readonly T[]; more: ReactNode } {
  const [count, setCount] = useState(PAGE);
  const left = rows.length - count;
  return {
    shown: rows.slice(0, count),
    more:
      left > 0 ? (
        <div className="flex justify-center p-4">
          <button type="button" className="btn btn-secondary" onClick={() => setCount(count + PAGE)}>
            Show {Math.min(PAGE, left)} more · {left} left
          </button>
        </div>
      ) : null,
  };
}

function StockRows({ rows }: { rows: readonly StockRow[] }) {
  const { shown, more } = useFirst(rows);
  return (
    <div className="-mx-5">
      <Table headings={['Location', 'Pallet', 'SKU', 'Lot', 'Best before', 'Cases']}>
        {shown.map((line) => (
          <tr key={`${line.pallet_id}-${line.location}`} className={row}>
            <td className={cell}>
              <p className="telemetry whitespace-nowrap">{line.location}</p>
              {line.area !== 'storage' && (
                <p className="text-sm text-ink-mute">{AREA[line.area] ?? line.area}</p>
              )}
            </td>
            <td className={`${cell} telemetry whitespace-nowrap`}>{line.pallet_id}</td>
            <td className={`${cell} telemetry whitespace-nowrap`}>{line.sku}</td>
            <td className={`${cell} telemetry`}>{line.lot}</td>
            <td className={`${cell} whitespace-nowrap`}>{formatDate(line.best_before)}</td>
            <td className={`${cell} telemetry`}>{line.cases}</td>
          </tr>
        ))}
      </Table>
      {more}
    </div>
  );
}

function TaskRows({ list }: { list: readonly WarehouseTask[] }) {
  const { shown, more } = useFirst(list);
  return (
    <>
      <Table headings={['Task', 'Status', 'Pallet', 'From → to', 'Cases', 'Crew', 'Times']}>
        {shown.map((task) => (
          <tr key={task.key} className={row}>
            <td className={cell}>
              <p className="font-semibold whitespace-nowrap">{TASK_KIND[task.kind]}</p>
              <p className="telemetry whitespace-nowrap text-sm text-ink-mute">
                {task.order_number ?? task.sku}
              </p>
            </td>
            <td className={cell}>
              <Tag tone={task.status === 'assigned' ? 'ink' : 'plain'}>{TASK_STATUS[task.status]}</Tag>
              {task.note && <p className="mt-1 text-sm text-ink-mute">{task.note}</p>}
            </td>
            <td className={cell}>
              <p className="telemetry whitespace-nowrap">{task.pallet_id ?? '—'}</p>
              <p className="telemetry text-sm text-ink-mute">{task.sku}</p>
            </td>
            <td className={`${cell} telemetry whitespace-nowrap`}>
              {task.from_location ?? '—'} → {task.to_location ?? '—'}
            </td>
            <td className={`${cell} telemetry`}>
              {task.kind === 'cycle_count' ? (task.counted_cases ?? '—') : task.cases}
            </td>
            <td className={`${cell} whitespace-nowrap`}>{task.assignee_name}</td>
            <td className={`${cell} telemetry whitespace-nowrap text-sm`}>
              {task.queued_at} · {task.started_at} – {task.finished_at}
            </td>
          </tr>
        ))}
      </Table>
      {more}
    </>
  );
}

function Table({ headings, children }: { headings: readonly string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-xl border-collapse text-left">
        <thead>
          <tr className="border-b border-hairline">
            {headings.map((heading) => (
              <th key={heading} scope="col" className="label px-4 py-2 font-normal">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const cell = 'px-4 py-2.5';
const row = 'border-b border-hairline';

// ── Yard: the board, loads and receipts, the gate log ──

function Shipments({ online }: { online: boolean }) {
  const shipments = useShipments(online);
  return (
    <Panel title="Loads and receipts" aside={<SimulatedTag compact />} flush>
      {down(online, shipments.error) ? (
        <Offline />
      ) : (
        <QueryBoundary query={shipments} loading="Reading shipments">
          {(list) =>
            list.length === 0 ? (
              <div className="p-4">
                <EmptyState title="Nothing booked yet">
                  Waves and advance ship notices appear here.
                </EmptyState>
              </div>
            ) : (
              <Table headings={['Order', 'Customer', 'Wave or ASN', 'Status', 'Cases', 'Confirmation']}>
                {list.map((shipment) => (
                  <tr key={shipment.ref} className={row}>
                    <td className={cell}>
                      <p className="telemetry whitespace-nowrap">{shipment.order_number}</p>
                      <p className="telemetry whitespace-nowrap text-sm text-ink-mute">
                        {shipment.direction === 'inbound' ? 'In' : 'Out'} · door{' '}
                        {String(shipment.door).padStart(2, '0')}
                      </p>
                    </td>
                    <td className={cell}>
                      <p className="font-semibold">{shipment.customer}</p>
                      <p className="telemetry text-sm text-ink-mute">{shipment.trailer}</p>
                    </td>
                    <td className={`${cell} telemetry whitespace-nowrap`}>
                      {shipment.wave ?? 'ASN'} · {shipment.created_at}
                    </td>
                    <td className={cell}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Tag
                          tone={
                            shipment.status === 'loading' || shipment.status === 'receiving' ? 'ink' : 'plain'
                          }
                        >
                          {SHIPMENT_STATUS[shipment.status]}
                        </Tag>
                        {shipment.direction === 'outbound' &&
                          shipment.cases_allocated < shipment.cases_expected && (
                            <Tag tone="accent">Short</Tag>
                          )}
                      </div>
                    </td>
                    <td className={`${cell} telemetry whitespace-nowrap`}>
                      {formatNumber(
                        shipment.direction === 'outbound' ? shipment.cases_allocated : shipment.cases_done,
                      )}
                      <span className="text-ink-mute"> / {formatNumber(shipment.cases_expected)}</span>
                    </td>
                    <td className={`${cell} telemetry whitespace-nowrap`}>
                      {shipment.confirmation ?? '—'}
                      {shipment.seal && <p className="text-sm text-ink-mute">Seal {shipment.seal}</p>}
                    </td>
                  </tr>
                ))}
              </Table>
            )
          }
        </QueryBoundary>
      )}
    </Panel>
  );
}

function GateLog({ online }: { online: boolean }) {
  const gate = useGateLog(online);
  return (
    <Panel title="Gate log" aside={<SimulatedTag compact />} flush>
      {down(online, gate.error) ? (
        <Offline />
      ) : (
        <QueryBoundary query={gate} loading="Reading the gate">
          {(events) =>
            events.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No trailers yet">Check-ins appear as trailers reach the gate.</EmptyState>
              </div>
            ) : (
              <Table headings={['Time', 'Event', 'Trailer', 'Where', 'Seal', 'Reefer', 'On site']}>
                {events.map((event) => (
                  <tr key={event.id} className={row}>
                    <td className={`${cell} telemetry text-lg`}>{event.time}</td>
                    <td className={cell}>
                      <span className="label">{GATE_KIND[event.kind]}</span>
                    </td>
                    <td className={cell}>
                      <p className="telemetry whitespace-nowrap">{event.trailer}</p>
                      <p className="whitespace-nowrap text-sm text-ink-mute">
                        {event.order_number ?? event.carrier}
                      </p>
                    </td>
                    <td className={`${cell} telemetry whitespace-nowrap`}>
                      {event.kind === 'yard_move'
                        ? `${event.yard_spot ?? '—'} → door ${String(event.door ?? 0).padStart(2, '0')}`
                        : event.kind === 'gate_in'
                          ? (event.yard_spot ?? '—')
                          : event.door == null
                            ? '—'
                            : `Door ${String(event.door).padStart(2, '0')}`}
                    </td>
                    <td className={`${cell} telemetry whitespace-nowrap`}>{event.seal ?? '—'}</td>
                    <td className={`${cell} telemetry whitespace-nowrap`}>
                      {event.reefer_temp == null ? '—' : formatTemp(event.reefer_temp)}
                    </td>
                    <td className={cell}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {event.dwell_minutes != null && (
                          <span className="telemetry whitespace-nowrap">{duration(event.dwell_minutes)}</span>
                        )}
                        {event.late && <Tag tone="accent">Late</Tag>}
                        {event.detention && <Tag tone="accent">Detention</Tag>}
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            )
          }
        </QueryBoundary>
      )}
    </Panel>
  );
}

// ── Inventory: occupancy by room, then the stock in one room ──

function Occupancy({ rooms }: { rooms: ColdRoom[] }) {
  return (
    <StatGrid>
      {rooms.map((room) => (
        <Stat
          key={room.code}
          label={room.name}
          value={<span className="telemetry">{room.pallets}</span>}
          sub={
            <>
              <span className="block">
                {formatNumber(room.cases)} cases · {room.occupied} of {room.slots} positions
              </span>
              <span className="meter mt-2 block h-2" aria-hidden="true">
                <span
                  className="meter-fill block"
                  style={{ width: `${Math.round((room.occupied / room.slots) * 100)}%` }}
                />
              </span>
              {room.on_hold_cases > 0 && (
                <span className="mt-1 block">{formatNumber(room.on_hold_cases)} cases on hold</span>
              )}
            </>
          }
        />
      ))}
    </StatGrid>
  );
}

function Inventory({ online }: { online: boolean }) {
  const [room, setRoom] = useState<RoomCode>('F');
  const rooms = useColdRooms(online);
  const stock = useStock(room, online);
  if (down(online, rooms.error ?? stock.error)) return <Offline />;
  return (
    <div className="flex flex-col gap-6">
      <QueryBoundary query={rooms} loading="Counting the rooms">
        {(list) => <Occupancy rooms={list} />}
      </QueryBoundary>
      <Panel title="On hand" aside={<SimulatedTag compact />}>
        <div className="flex flex-col gap-4">
          <ChoiceGroup label="Room" options={ROOMS} value={room} onChange={setRoom} columns={4} />
          <QueryBoundary query={stock} loading="Reading the stock">
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState title="Empty room">Nothing is stored here.</EmptyState>
              ) : (
                <StockRows rows={rows} />
              )
            }
          </QueryBoundary>
        </div>
      </Panel>
    </div>
  );
}

// ── Tasks: crew productivity, then the queue ──

function Tasks({ online }: { online: boolean }) {
  const crew = useCrewProductivity(online);
  const tasks = useWarehouseTasks(online);
  if (down(online, crew.error ?? tasks.error)) return <Offline />;
  return (
    <div className="flex flex-col gap-6">
      <Panel title="Crew this shift" aside={<SimulatedTag compact />} flush>
        <QueryBoundary query={crew} loading="Adding up the shift">
          {(rows) => (
            <Table headings={['Crew', 'Done', 'Per hour', 'Cases an hour', 'Busy']}>
              {rows.map((member) => (
                <tr key={member.code} className={row}>
                  <td className={cell}>
                    <p className="font-semibold">{member.name}</p>
                    <p className="telemetry text-sm text-ink-mute">
                      {member.code} · {member.role === 'warehouse' ? 'Warehouse' : 'Dock'}
                    </p>
                  </td>
                  <td className={`${cell} telemetry text-lg`}>{member.tasks_done}</td>
                  <td className={`${cell} telemetry`}>{member.tasks_per_hour}</td>
                  <td className={`${cell} telemetry`}>{formatNumber(member.cases_per_hour)}</td>
                  <td className={cell}>
                    {member.busy_percent == null ? (
                      <span className="text-ink-mute">—</span>
                    ) : (
                      <div className="flex min-w-32 items-center gap-2">
                        <div
                          className="meter h-2 flex-1"
                          role="progressbar"
                          aria-label={`${member.name} busy`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={member.busy_percent}
                        >
                          <div className="meter-fill" style={{ width: `${member.busy_percent}%` }} />
                        </div>
                        <span className="telemetry">{Math.round(member.busy_percent)}%</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </QueryBoundary>
      </Panel>
      <Panel title="Task queue" aside={<SimulatedTag compact />} flush>
        <QueryBoundary query={tasks} loading="Reading the queue">
          {(list) =>
            list.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No tasks yet">
                  Put-aways, picks and counts queue here as the shift runs.
                </EmptyState>
              </div>
            ) : (
              <TaskRows list={list} />
            )
          }
        </QueryBoundary>
      </Panel>
    </div>
  );
}

// ── Cold rooms ──

const TRACE_W = 320;
const TRACE_H = 96;

/** The room's recent readings as one line against its alarm line; the exact values stay readable. */
function Trace({ room }: { room: ColdRoom }) {
  const temps = room.readings.map((reading) => reading.temp);
  const low = Math.min(...temps, room.setpoint) - 2;
  const high = Math.max(...temps, room.limit) + 2;
  const x = (index: number) => 4 + (index / (room.readings.length - 1)) * (TRACE_W - 8);
  const y = (temp: number) => 6 + ((high - temp) / (high - low)) * (TRACE_H - 12);
  const line = room.readings.map((reading, index) => `${x(index).toFixed(1)},${y(reading.temp).toFixed(1)}`);
  const first = room.readings[0];
  const last = room.readings.at(-1);
  return (
    <figure className={`room-${room.code} flex flex-col gap-1.5`}>
      <svg viewBox={`0 0 ${TRACE_W} ${TRACE_H}`} className="block h-auto w-full" aria-hidden="true">
        <polygon
          points={`${x(0).toFixed(1)},${TRACE_H} ${line.join(' ')} ${x(room.readings.length - 1).toFixed(1)},${TRACE_H}`}
          className="room-wash"
        />
        <line x1="0" x2={TRACE_W} y1={y(room.limit)} y2={y(room.limit)} className="room-limit" />
        <line x1="0" x2={TRACE_W} y1={y(room.setpoint)} y2={y(room.setpoint)} className="room-setpoint" />
        <polyline points={line.join(' ')} className="room-line" />
        {room.readings.map((reading, index) =>
          reading.temp > room.limit ? (
            <circle key={reading.minute} cx={x(index)} cy={y(reading.temp)} r="3.5" className="room-over" />
          ) : null,
        )}
      </svg>
      <figcaption className="flex justify-between text-sm text-ink-mute">
        <span className="telemetry">{first?.time}</span>
        <span>
          Dashed: alarm at <span className="telemetry">{formatTemp(room.limit)}</span>
        </span>
        <span className="telemetry">{last?.time}</span>
      </figcaption>
      <ol className="sr-only" aria-label="Recent readings">
        {room.readings.map((reading) => (
          <li key={reading.minute}>
            {reading.time}: {formatTemp(reading.temp)}
            {reading.temp > room.limit && ', over the limit'}
          </li>
        ))}
      </ol>
    </figure>
  );
}

function Room({ room }: { room: ColdRoom }) {
  return (
    <Panel
      title={room.name}
      aside={
        room.alarm ? (
          <Tag tone="hazard">
            <Thermometer size={16} aria-hidden="true" /> Alarm
          </Tag>
        ) : room.over_limit ? (
          <Tag tone="accent">Over limit</Tag>
        ) : (
          <Tag>In range</Tag>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <p className="telemetry text-4xl leading-none">{formatTemp(room.temp)}</p>
        <dl className="grid grid-cols-2 gap-3">
          <Definition term="Set-point" mono>
            {formatTemp(room.setpoint)}
          </Definition>
          <Definition term="Alarm above" mono>
            {formatTemp(room.limit)}
          </Definition>
        </dl>
        {room.readings.length > 1 && <Trace room={room} />}
      </div>
    </Panel>
  );
}

function ColdRooms({ online }: { online: boolean }) {
  const rooms = useColdRooms(online);
  if (down(online, rooms.error)) return <Offline />;
  return (
    <QueryBoundary query={rooms} loading="Reading the sensors">
      {(list) => (
        <div className="flex flex-col gap-4">
          <p className="text-base text-ink-soft">
            Sampled every five minutes. Fifteen minutes over the limit raises the alarm, and it is filed as a
            cold-chain issue. <SimulatedTag compact />
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {list.map((room) => (
              <Room key={room.code} room={room} />
            ))}
          </div>
        </div>
      )}
    </QueryBoundary>
  );
}

// ── Transactions: the movement ledger, newest first, paged ──

function Ledger({
  online,
  pallet,
  onClearPallet,
}: {
  online: boolean;
  pallet: string | null;
  onClearPallet: () => void;
}) {
  const [pages, setPages] = useState<number[]>([]);
  const before = pages.at(-1) ?? null;
  const ledger = useLedger(before, online, pallet);
  if (down(online, ledger.error)) return <Offline />;
  return (
    <Panel
      title={pallet ? `Movements of pallet ${pallet}` : 'Movement ledger'}
      aside={
        <span className="flex items-center gap-2">
          {pallet && (
            <button type="button" className="btn btn-secondary" onClick={onClearPallet}>
              <X size={18} aria-hidden="true" /> All pallets
            </button>
          )}
          <SimulatedTag compact />
        </span>
      }
      flush
    >
      <QueryBoundary query={ledger} loading="Reading the ledger">
        {(entries) => {
          const oldest = entries.at(-1);
          return (
            <>
              {entries.length === 0 ? (
                <div className="p-4">
                  <EmptyState title="No movements">
                    Every receipt, put-away, pick and load is written here.
                  </EmptyState>
                </div>
              ) : (
                <Table headings={['Time', 'Movement', 'Pallet', 'From → to', 'Cases', 'By']}>
                  {entries.map((entry) => (
                    <tr key={entry.id} className={row}>
                      <td className={`${cell} telemetry text-lg`}>{entry.time}</td>
                      <td className={cell}>
                        <p className="font-semibold">{MOVEMENT[entry.kind]}</p>
                        {entry.order_number && (
                          <p className="telemetry text-sm text-ink-mute">{entry.order_number}</p>
                        )}
                      </td>
                      <td className={cell}>
                        <p className="telemetry whitespace-nowrap">{entry.pallet_id}</p>
                        <p className="telemetry whitespace-nowrap text-sm text-ink-mute">
                          {entry.sku} · {entry.lot}
                        </p>
                      </td>
                      <td className={`${cell} telemetry whitespace-nowrap`}>
                        {entry.from_location ?? 'In'} → {entry.to_location ?? 'Out'}
                      </td>
                      <td className={`${cell} telemetry`}>{entry.cases}</td>
                      <td className={`${cell} whitespace-nowrap`}>{entry.actor_name}</td>
                    </tr>
                  ))}
                </Table>
              )}
              <div className="flex flex-wrap justify-end gap-2 p-4">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={pages.length === 0}
                  onClick={() => setPages([])}
                >
                  Latest
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={oldest === undefined || entries.length < 50}
                  onClick={() => {
                    if (oldest) setPages([...pages, oldest.id]);
                  }}
                >
                  Older
                </button>
              </div>
            </>
          );
        }}
      </QueryBoundary>
    </Panel>
  );
}

function isView(value: string | null): value is View {
  return VIEWS.some((view) => view.id === value);
}

/**
 * The simulated WMS's warehouse, one view at a time. `yard` is the page's yard board. The view and a
 * pallet filter live in the URL (`?view=ledger&pallet=…`), so an issue's held pallet links straight to
 * its movements.
 */
export function WarehouseTabs({ online, yard }: { online: boolean; yard: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const view: View = isView(requested) ? requested : 'yard';
  const palletParam = params.get('pallet')?.trim() ?? '';
  const pallet = palletParam === '' ? null : palletParam;
  const top = useRef<HTMLDivElement>(null);
  const linked = useRef(pallet !== null);

  // Arriving from an issue's held pallet: bring the ledger into view once.
  useEffect(() => {
    if (!linked.current) return;
    linked.current = false;
    top.current?.scrollIntoView({ block: 'start' });
  }, []);

  const change = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const setView = (next: View) => change('view', next === 'yard' ? null : next);

  return (
    <div ref={top} className="flex flex-col gap-4">
      <Tabs tabs={VIEWS} active={view} onChange={setView} label="Warehouse views" panelId={PANEL_ID} />
      <div
        role="tabpanel"
        id={PANEL_ID}
        aria-labelledby={`${PANEL_ID}-tab-${view}`}
        className="flex flex-col gap-6"
      >
        {view === 'yard' && (
          <>
            {yard}
            <Shipments online={online} />
            <GateLog online={online} />
          </>
        )}
        {view === 'inventory' && <Inventory online={online} />}
        {view === 'tasks' && <Tasks online={online} />}
        {view === 'rooms' && <ColdRooms online={online} />}
        {view === 'ledger' && (
          <Ledger
            key={pallet ?? 'all'}
            online={online}
            pallet={pallet}
            onClearPallet={() => change('pallet', null)}
          />
        )}
      </div>
      <p className="text-sm text-ink-mute">
        Problems the warehouse finds are filed as issues and appear in the{' '}
        <Link to="/app/log" className="underline">
          issue log
        </Link>
        .
      </p>
    </div>
  );
}
