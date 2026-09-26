/**
 * A handoff note as editable sections, pre-filled from `GET /api/shift-handoffs/draft`. Each section is
 * plain text the supervisor can change; the note saved is the sections that still have text, under
 * their headings.
 */
import type { HandoffDraft } from '../api/types';
import { formatTemp } from './format';

export const HANDOFF_MAX = 2000;

export interface HandoffSection {
  id: 'criticals' | 'decisions' | 'trailers' | 'rooms' | 'requests' | 'other';
  heading: string;
  text: string;
}

const TRAILER_STATE = { scheduled: 'due', in_yard: 'in the yard', at_door: 'at the door' } as const;

const door = (value: number | null | undefined) => (value == null ? '' : `, Dock ${String(value)}`);

export function sectionsFrom(draft: HandoffDraft, extra = ''): HandoffSection[] {
  return [
    {
      id: 'criticals',
      heading: 'Open critical issues',
      text: draft.open_criticals
        .map((line) => `#${String(line.id)} ${line.title}${door(line.door_number)}`)
        .join('\n'),
    },
    {
      id: 'decisions',
      heading: 'Decisions this shift',
      text: draft.decisions
        .map(
          (line) =>
            `#${String(line.id)} ${line.title}: ${line.decision}${line.status === 'on_hold' ? ' (on hold)' : ''}`,
        )
        .join('\n'),
    },
    {
      id: 'trailers',
      heading: 'Trailers',
      text: draft.trailers
        .map(
          (line) =>
            `${line.trailer} (${line.carrier}) ${TRAILER_STATE[line.state]}${door(line.door)}${line.detention ? ', on detention' : ''}`,
        )
        .join('\n'),
    },
    {
      id: 'rooms',
      heading: 'Cold rooms',
      text: draft.room_alarms
        .map(
          (room) =>
            `${room.name} at ${formatTemp(room.temp)} (limit ${formatTemp(room.limit)})${room.alarm ? ', in alarm' : ''}`,
        )
        .join('\n'),
    },
    {
      id: 'requests',
      heading: 'Requests still open',
      text: draft.pending_requests
        .map(
          (request) =>
            `${request.request_type}${request.operator_name ? ` for ${request.operator_name}` : ''}${door(request.door_number)}`,
        )
        .join('\n'),
    },
    {
      id: 'other',
      heading: 'Anything else',
      text: [draft.wms_online ? '' : 'The WMS is offline: work from the paper load sheet.', extra]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

export function composeHandoff(sections: readonly HandoffSection[]): string {
  return sections
    .filter((section) => section.text.trim())
    .map((section) => `${section.heading}:\n${section.text.trim()}`)
    .join('\n\n');
}
