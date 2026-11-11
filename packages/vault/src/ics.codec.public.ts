export type VaultCalendarList = {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VaultCalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  date: string;
  time?: string;
  allDay: boolean;
  timezone: string;
  location?: string;
  description?: string;
  recurrence?: {
    frequency: 'once' | 'daily' | 'weekly';
    interval: number;
    weekdays: number[];
    localTime: string;
    timezone: string;
    startDate: string;
  };
  reminderMinutes?: number;
  automationId?: string;
  automationOccurrenceId?: string;
  createdAt: string;
  updatedAt: string;
};

const WEEKDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let remaining = line;
  while (remaining.length > 75) {
    parts.push(remaining.slice(0, 75));
    remaining = ` ${remaining.slice(75)}`;
  }
  parts.push(remaining);
  return parts.join('\r\n');
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function unescapeText(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function nextDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return date.toISOString().slice(0, 10);
}

function addMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const total = hh! * 60 + mm! + minutes;
  const dayOffset = Math.floor(total / (24 * 60));
  const rem = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const end = new Date(Date.UTC(y!, m! - 1, d! + dayOffset));
  const outDate = end.toISOString().slice(0, 10);
  const outTime = `${String(Math.floor(rem / 60)).padStart(2, '0')}:${String(rem % 60).padStart(2, '0')}`;
  return { date: outDate, time: outTime };
}

function formatUtcStamp(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '19700101T000000Z';
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function rruleFromRecurrence(recurrence: NonNullable<VaultCalendarEvent['recurrence']>): string | null {
  if (recurrence.frequency === 'once') return null;
  if (recurrence.frequency === 'daily') return `FREQ=DAILY;INTERVAL=${recurrence.interval}`;
  const byday = recurrence.weekdays.map((day) => WEEKDAY[day]).join(',');
  return `FREQ=WEEKLY;INTERVAL=${recurrence.interval};BYDAY=${byday}`;
}

function recurrenceFromRrule(
  rrule: string,
  localTime: string,
  timezone: string,
  startDate: string,
): VaultCalendarEvent['recurrence'] | undefined {
  const parts = Object.fromEntries(rrule.split(';').map((piece) => {
    const [key, value] = piece.split('=');
    return [key?.toUpperCase() ?? '', value ?? ''];
  }));
  const freq = parts.FREQ?.toUpperCase();
  const interval = Number(parts.INTERVAL ?? '1');
  if (freq === 'DAILY') {
    return { frequency: 'daily', interval, weekdays: [], localTime, timezone, startDate };
  }
  if (freq === 'WEEKLY') {
    const weekdays = (parts.BYDAY ?? '').split(',').filter(Boolean).map((token) => WEEKDAY.indexOf(token as typeof WEEKDAY[number])).filter((n) => n >= 0);
    return { frequency: 'weekly', interval, weekdays, localTime, timezone, startDate };
  }
  return undefined;
}

export function serializeCalendarIcs(list: VaultCalendarList, events: readonly VaultCalendarEvent[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AIR Office//EN',
    'CALSCALE:GREGORIAN',
    fold(`X-WR-CALNAME:${escapeText(list.name)}`),
    fold(`X-AIR-ID:${escapeText(list.id)}`),
    fold(`X-AIR-COLOR:${list.color}`),
    fold(`X-AIR-VISIBLE:${list.visible ? 'TRUE' : 'FALSE'}`),
  ];
  for (const event of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(fold(`UID:${escapeText(event.id)}`));
    lines.push(fold(`SUMMARY:${escapeText(event.title)}`));
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${event.date.replace(/-/g, '')}`);
      lines.push(`DTEND;VALUE=DATE:${nextDay(event.date).replace(/-/g, '')}`);
    } else {
      const time = event.time ?? '00:00';
      const end = addMinutes(event.date, time, 30);
      lines.push(`DTSTART;TZID=${event.timezone}:${event.date.replace(/-/g, '')}T${time.replace(':', '')}00`);
      lines.push(`DTEND;TZID=${event.timezone}:${end.date.replace(/-/g, '')}T${end.time.replace(':', '')}00`);
    }
    if (event.location) lines.push(fold(`LOCATION:${escapeText(event.location)}`));
    if (event.description) lines.push(fold(`DESCRIPTION:${escapeText(event.description)}`));
    if (event.recurrence) {
      const rule = rruleFromRecurrence(event.recurrence);
      if (rule) lines.push(`RRULE:${rule}`);
    }
    if (event.reminderMinutes !== undefined) {
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`TRIGGER:-PT${event.reminderMinutes}M`);
      lines.push('DESCRIPTION:Reminder');
      lines.push('END:VALARM');
    }
    if (event.automationId) lines.push(fold(`X-AIR-AUTOMATION-ID:${escapeText(event.automationId)}`));
    if (event.automationOccurrenceId) lines.push(fold(`X-AIR-OCCURRENCE-ID:${escapeText(event.automationOccurrenceId)}`));
    lines.push(`CREATED:${formatUtcStamp(event.createdAt)}`);
    lines.push(`LAST-MODIFIED:${formatUtcStamp(event.updatedAt)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

function unfold(raw: string): string[] {
  const physical = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const logical: string[] = [];
  for (const line of physical) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (logical.length === 0) throw new Error('Malformed ICS: folded line without parent.');
      logical[logical.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      logical.push(line);
    }
  }
  return logical;
}

function parseProp(line: string): { name: string; params: Record<string, string>; value: string } {
  const colon = line.indexOf(':');
  if (colon < 0) throw new Error(`Malformed ICS property: ${line}`);
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = left.split(';');
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf('=');
    if (eq < 0) params[part.toUpperCase()] = '';
    else params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return { name: (name ?? '').toUpperCase(), params, value };
}

function parseDateValue(value: string): string {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  if (/^\d{8}T\d{6}/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  throw new Error(`Unsupported ICS date: ${value}`);
}

function parseTimeValue(value: string): string | undefined {
  const match = /^\d{8}T(\d{2})(\d{2})/.exec(value);
  if (!match) return undefined;
  return `${match[1]}:${match[2]}`;
}

export function parseCalendarIcs(raw: string): { list: VaultCalendarList; events: VaultCalendarEvent[] } {
  const lines = unfold(raw);
  if (lines[0] !== 'BEGIN:VCALENDAR') throw new Error('Malformed ICS: missing VCALENDAR.');
  let name = 'Calendar';
  let id = 'calendar';
  let color = '#4A90D9';
  let visible = true;
  const events: VaultCalendarEvent[] = [];
  let current: Record<string, string> | null = null;
  let currentParams: Record<string, Record<string, string>> = {};
  let reminderMinutes: number | undefined;
  let inAlarm = false;

  for (const line of lines.slice(1)) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      currentParams = {};
      reminderMinutes = undefined;
      inAlarm = false;
      continue;
    }
    if (line === 'BEGIN:VALARM') {
      inAlarm = true;
      continue;
    }
    if (line === 'END:VALARM') {
      inAlarm = false;
      continue;
    }
    if (line === 'END:VEVENT') {
      if (!current?.UID || !current.SUMMARY || !current.DTSTART) throw new Error('Malformed VEVENT: missing UID, SUMMARY, or DTSTART.');
      const allDay = currentParams.DTSTART?.VALUE === 'DATE' || !current.DTSTART.includes('T');
      const date = parseDateValue(current.DTSTART);
      const time = allDay ? undefined : parseTimeValue(current.DTSTART);
      const timezone = currentParams.DTSTART?.TZID || 'UTC';
      const localTime = time ?? '00:00';
      const recurrence = current.RRULE
        ? recurrenceFromRrule(current.RRULE, localTime, timezone, date)
        : undefined;
      events.push({
        id: unescapeText(current.UID),
        calendarId: id,
        title: unescapeText(current.SUMMARY),
        date,
        ...(time ? { time } : {}),
        allDay,
        timezone,
        ...(current.LOCATION ? { location: unescapeText(current.LOCATION) } : {}),
        ...(current.DESCRIPTION ? { description: unescapeText(current.DESCRIPTION) } : {}),
        ...(recurrence ? { recurrence } : {}),
        ...(reminderMinutes !== undefined ? { reminderMinutes } : {}),
        ...(current['X-AIR-AUTOMATION-ID'] ? { automationId: unescapeText(current['X-AIR-AUTOMATION-ID']) } : {}),
        ...(current['X-AIR-OCCURRENCE-ID'] ? { automationOccurrenceId: unescapeText(current['X-AIR-OCCURRENCE-ID']) } : {}),
        createdAt: current.CREATED ? icsStampToIso(current.CREATED) : new Date(0).toISOString(),
        updatedAt: current['LAST-MODIFIED'] ? icsStampToIso(current['LAST-MODIFIED']) : new Date(0).toISOString(),
      });
      current = null;
      continue;
    }
    if (line === 'END:VCALENDAR') break;
    const prop = parseProp(line);
    if (!current && !inAlarm) {
      if (prop.name === 'X-WR-CALNAME') name = unescapeText(prop.value);
      if (prop.name === 'X-AIR-ID') id = unescapeText(prop.value);
      if (prop.name === 'X-AIR-COLOR') color = prop.value;
      if (prop.name === 'X-AIR-VISIBLE') visible = prop.value.toUpperCase() !== 'FALSE';
      continue;
    }
    if (inAlarm && prop.name === 'TRIGGER') {
      const match = /-PT(\d+)M/i.exec(prop.value);
      if (match) reminderMinutes = Number(match[1]);
      continue;
    }
    if (current) {
      current[prop.name] = prop.value;
      currentParams[prop.name] = prop.params;
    }
  }

  const now = new Date().toISOString();
  return {
    list: { id, name, color, visible, createdAt: now, updatedAt: now },
    events: events.map((event) => ({ ...event, calendarId: id })),
  };
}

function icsStampToIso(value: string): string {
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}.000Z`;
  }
  return new Date(0).toISOString();
}
