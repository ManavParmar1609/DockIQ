/** Display formatting. Pure functions, unit-tested in format.test.ts. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "12m ago", "3h ago", "4d ago" — rolls up past minutes (the old UI printed "27914m ago"). */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - new Date(iso).getTime());
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  return `${Math.floor(elapsed / DAY)}d ago`;
}

/** Elapsed time as a compact clock: "7m", "1h 05m", "2d 3h". */
export function elapsed(iso: string, now: number = Date.now()): string {
  return duration(Math.floor((now - new Date(iso).getTime()) / MINUTE));
}

/** A number of minutes as "7m", "1h 05m", "2d 3h". */
export function duration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.floor(totalMinutes));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const moneyCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const integer = new Intl.NumberFormat('en-US');

export const formatMoney = (value: number): string => (value < 100 ? moneyCents : money).format(value);
export const formatNumber = (value: number): string => integer.format(value);
export const formatTemp = (value: number): string =>
  `${value > 0 ? '' : value < 0 ? '−' : ''}${Math.abs(value)}°F`;
export const formatWeight = (lbs: number): string => `${integer.format(Math.round(lbs))} lb`;

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A calendar date ("2026-10-12") as "12 Oct 2026", without a timezone shift. */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function greeting(hour: number = new Date().getHours()): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** 0–100, safe for an empty order (the old UI showed "NaN%"). */
export function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}
