export type Recurrence = {
  frequency: 'once' | 'daily' | 'weekly';
  interval: number;
  weekdays: number[];
  localTime: string;
  timezone: string;
  startDate: string;
};

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.toISOString().slice(0, 10) === value;
}

export function validateRecurrence(value: unknown): value is Recurrence {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if ((item.frequency !== 'once' && item.frequency !== 'daily' && item.frequency !== 'weekly') || !Number.isSafeInteger(item.interval) || Number(item.interval) < 1 || Number(item.interval) > 365) return false;
  if (!Array.isArray(item.weekdays) || item.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) || new Set(item.weekdays).size !== item.weekdays.length) return false;
  if (item.frequency === 'weekly' && item.weekdays.length === 0) return false;
  if (typeof item.localTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.localTime)) return false;
  if (typeof item.timezone !== 'string' || !item.timezone) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: item.timezone }).format(0); } catch { return false; }
  return typeof item.startDate === 'string' && validDate(item.startDate);
}

function dateParts(date: Date): { year: number; month: number; day: number } {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function localParts(at: Date, timezone: string): LocalParts {
  const values = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(values.find((part) => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute') };
}

function localDateTimeToInstant(parts: LocalParts, timezone: string): Date {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const matching: number[] = [];
  for (const sample of [desired - 36 * 60 * 60_000, desired, desired + 36 * 60 * 60_000]) {
    const observed = localParts(new Date(sample), timezone);
    const offset = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute) - sample;
    const candidate = desired - offset;
    const actual = localParts(new Date(candidate), timezone);
    if (actual.year === parts.year && actual.month === parts.month && actual.day === parts.day && actual.hour === parts.hour && actual.minute === parts.minute) matching.push(candidate);
  }
  if (matching.length) return new Date(Math.min(...matching));
  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = localParts(new Date(guess), timezone);
    const observedWallTime = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute);
    const delta = desired - observedWallTime;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

/** Returns upcoming matching instants. Repeated local times during a DST fold run once at the earlier matching instant. */
export function nextOccurrences(recurrence: Recurrence, after: Date, count: number): Date[] {
  if (!validateRecurrence(recurrence) || !Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('Invalid schedule request.');
  const start = new Date(`${recurrence.startDate}T00:00:00Z`);
  if (recurrence.frequency === 'once') {
    const [hour, minute] = recurrence.localTime.split(':').map(Number);
    const occurrence = localDateTimeToInstant({ ...dateParts(start), hour: hour!, minute: minute! }, recurrence.timezone);
    return occurrence.getTime() > after.getTime() ? [occurrence] : [];
  }
  const output: Date[] = [];
  for (let offset = 0; offset <= 36500 && output.length < count; offset += 1) {
    const day = new Date(start.getTime() + offset * 86_400_000);
    const date = dateParts(day);
    const weekday = day.getUTCDay();
    let matches = false;
    if (recurrence.frequency === 'daily') matches = offset % recurrence.interval === 0;
    else {
      const firstWeekMonday = new Date(start.getTime() - ((start.getUTCDay() + 6) % 7) * 86_400_000);
      const currentWeekMonday = new Date(day.getTime() - ((weekday + 6) % 7) * 86_400_000);
      const elapsedWeeks = Math.round((currentWeekMonday.getTime() - firstWeekMonday.getTime()) / (7 * 86_400_000));
      matches = elapsedWeeks % recurrence.interval === 0 && recurrence.weekdays.includes(weekday);
    }
    if (!matches) continue;
    const [hour, minute] = recurrence.localTime.split(':').map(Number);
    const occurrence = localDateTimeToInstant({ ...date, hour: hour!, minute: minute! }, recurrence.timezone);
    if (occurrence.getTime() > after.getTime()) output.push(occurrence);
  }
  return output;
}

// ===== Calendar events (CHAT-197/198/199)

/**
 * An event is a dated entry a person or an automation places on a calendar:
 * a title, optional all-day flag, location and description, an optional
 * recurrence for repeating events, and an optional reminder lead in minutes.
 * Schedule projections link through `automationId`; generated result events
 * also retain `automationOccurrenceId` and remain independently editable.
 */

export type CalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  /** Start day in `YYYY-MM-DD`; the event's local date in its timezone. */
  date: string;
  /** `HH:MM` local wall time; absent for all-day events. */
  time?: string;
  allDay: boolean;
  /** IANA timezone the wall time reads in; defaults to the operator's zone at creation. */
  timezone: string;
  location?: string;
  description?: string;
  /** Repeating events carry a recurrence; single events omit it. */
  recurrence?: Recurrence;
  /** Minutes before the event to remind; absent means no reminder. */
  reminderMinutes?: number;
  /** Source automation for a projection or generated result. */
  automationId?: string;
  /** Provenance of a generated result event, distinct from a schedule projection. */
  automationOccurrenceId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CalendarList = {
  id: string;
  name: string;
  /** CSS color for the calendar's events. */
  color: string;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function validCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.toISOString().slice(0, 10) === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function optionalText(value: unknown, max: number): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length <= max);
}

export function validateCalendarList(value: unknown): value is CalendarList {
  if (!isRecord(value)) return false;
  if (!identity(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120) return false;
  if (typeof value.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.color)) return false;
  if (typeof value.visible !== 'boolean') return false;
  return typeof value.createdAt === 'string' && typeof value.updatedAt === 'string';
}

export function validateCalendarEvent(value: unknown): value is CalendarEvent {
  if (!isRecord(value)) return false;
  if (!identity(value.id) || !identity(value.calendarId)) return false;
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200) return false;
  if (typeof value.date !== 'string' || !validCalendarDate(value.date)) return false;
  if (typeof value.allDay !== 'boolean') return false;
  if (!value.allDay) {
    if (typeof value.time !== 'string' || !TIME_PATTERN.test(value.time)) return false;
  } else if (value.time !== undefined) return false;
  if (typeof value.timezone !== 'string' || !value.timezone) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format(0); } catch { return false; }
  if (!optionalText(value.location, 300)) return false;
  if (!optionalText(value.description, 5000)) return false;
  if (value.recurrence !== undefined && (typeof value.recurrence !== 'object' || value.recurrence === null || !validateRecurrence(value.recurrence))) return false;
  if (value.reminderMinutes !== undefined && (typeof value.reminderMinutes !== 'number' || !Number.isSafeInteger(value.reminderMinutes) || value.reminderMinutes < 0 || value.reminderMinutes > 40320)) return false;
  if (value.automationId !== undefined && !identity(value.automationId)) return false;
  if (!optionalText(value.automationOccurrenceId, 500)) return false;
  return typeof value.createdAt === 'string' && typeof value.updatedAt === 'string';
}

/** Days on a month grid: six weeks so every month fills the same shape. */
export function monthGridDays(year: number, month: number, weekStartsOn: 0 | 1 = 1): { date: string; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() - weekStartsOn + 7) % 7;
  const start = new Date(first.getTime() - offset * 86_400_000);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start.getTime() + index * 86_400_000);
    return { date: day.toISOString().slice(0, 10), inMonth: day.getUTCMonth() === month - 1 };
  });
}

/** Seven dates of the week that contains `isoDate`, starting Monday by default. */
export function weekDays(isoDate: string, weekStartsOn: 0 | 1 = 1): string[] {
  const [year, month, day] = isoDate.split('-').map(Number);
  const anchor = new Date(Date.UTC(year!, month! - 1, day!));
  const offset = (anchor.getUTCDay() - weekStartsOn + 7) % 7;
  const start = new Date(anchor.getTime() - offset * 86_400_000);
  return Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10));
}

/**
 * Projects events onto the given days, expanding recurring ones into the
 * visible window. The recurrence engine computes concrete instants so a
 * DST shift moves the wall time exactly as the automations scheduler runs.
 */
export function eventsOnDays(events: CalendarEvent[], days: string[]): Map<string, CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>(days.map((date) => [date, []]));
  const from = days[0]!;
  const to = days.at(-1)!;
  const windowStart = new Date(`${from}T00:00:00Z`);
  const windowEnd = new Date(`${to}T23:59:59Z`);
  for (const event of events) {
    if (!event.recurrence) {
      const bucket = byDay.get(event.date);
      if (bucket) bucket.push(event);
      continue;
    }
    // Generating from the window (not the event start) keeps the occurrence cap
    // focused on visible days, so a years-old daily event still appears.
    const searchStart = new Date(windowStart.getTime() - 8 * 86_400_000);
    for (const instant of nextOccurrences(event.recurrence, searchStart, 400)) {
      if (instant.getTime() > windowEnd.getTime()) break;
      const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: event.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
      const bucket = byDay.get(localDate);
      if (bucket) bucket.push(event);
    }
  }
  return byDay;
}
