import { eventsOnDays, validateCalendarEvent, validateCalendarList, validCalendarDate, nextOccurrences } from '@office/calendar/domain';
import type { CalendarEvent, CalendarList } from '@office/calendar/domain';
import { validateAutomation } from '@office/automations/domain';
import type { AutomationDefinition } from '@office/automations/domain';
import type { CalendarStore } from '@office/calendar/store';
import type { createAutomationsService } from '@office/automations/service';
import { automationRelative, calendarPathForListId, defaultConversationPath } from '@office/vault/domain';

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
type CalendarBundle = { schema_version: 1; calendars: CalendarList[]; events: CalendarEvent[]; automations: AutomationDefinition[] };

export function parseCalendarBundle(value: unknown): CalendarBundle {
  if (!record(value) || value.schema_version !== 1) throw new Error('Use calendar JSON with schema_version: 1.');
  const now = new Date().toISOString();
  function rows(key: string) {
    const list = value && record(value) ? value[key] ?? [] : [];
    if (!Array.isArray(list) || list.length > 100) throw new Error(`${key} must be an array of at most 100 items.`);
    const seen = new Set<string>();
    return list.map((entry: unknown) => {
      if (!record(entry) || typeof entry.id !== 'string' || !entry.id || entry.id.length > 120 || seen.has(entry.id)) throw new Error(`${key} needs unique, nonempty IDs of at most 120 characters.`);
      seen.add(entry.id);
      return { ...entry, createdAt: entry.createdAt ?? now, updatedAt: now };
    });
  }
  const calendars = rows('calendars').map((entry) => {
    const candidate = { visible: true, ...entry };
    if (!validateCalendarList(candidate)) throw new Error('Each calendar needs id, name and a six-digit hex color.');
    return candidate;
  });
  const events = rows('events').map((entry) => {
    if ('automationId' in entry || 'automationOccurrenceId' in entry) throw new Error('Imported events cannot claim automation provenance. Import the automation definition instead.');
    const candidate = { allDay: true, ...entry };
    if (!validateCalendarEvent(candidate)) throw new Error('Each event needs calendarId, title, a valid date and timezone; timed events also need time.');
    return candidate;
  });
  const automations = rows('automations').map((entry) => {
    const path = typeof entry.path === 'string' && entry.path ? entry.path : automationRelative(String(entry.id));
    const candidate = { enabled: true, missedRunPolicy: 'skip', path, ...entry, path };
    if (!validateAutomation(candidate)) throw new Error('Each automation needs id, name, recurrence and valid workflow steps.');
    return candidate;
  });
  return { schema_version: 1, calendars, events, automations };
}

export function calendarJsonTemplate(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const tomorrow = new Date(Date.now() + 86_400_000);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(tomorrow);
  const calendarPath = calendarPathForListId('ai-planning');
  return {
    schema_version: 1,
    calendars: [{ id: 'ai-planning', name: 'Planning', color: '#3478db' }],
    events: [{ id: 'ai-review', calendarId: 'ai-planning', title: 'Review the plan', date, allDay: false, time: '14:00', timezone, description: 'Replace this example with your event.' }],
    automations: [{
      id: 'ai-briefing',
      path: automationRelative('ai-briefing'),
      name: 'Prepare my briefing',
      enabled: true,
      missedRunPolicy: 'skip',
      recurrence: { frequency: 'once', interval: 1, weekdays: [], startDate: date, localTime: '09:00', timezone },
      steps: [
        { kind: 'prompt', prompt: 'Write a short plan for my day.' },
        { kind: 'calendar-event', calendarPath, title: 'Daily plan', daysAfterRun: 0, allDay: true },
      ],
    }],
  };
}

/** Maps optional from/to or days onto an inclusive YYYY-MM-DD window for Settings import preview helpers. */
export function resolveCalendarReadWindow(input: { from?: unknown; to?: unknown; days?: unknown }): { from?: string; to?: string } {
  const from = typeof input.from === 'string' ? input.from : undefined;
  const to = typeof input.to === 'string' ? input.to : undefined;
  if (from !== undefined || to !== undefined) return { from, to };
  const days = typeof input.days === 'number' && Number.isSafeInteger(input.days) ? input.days : undefined;
  if (days === undefined) return {};
  const first = new Date().toLocaleDateString('en-CA');
  const start = new Date(`${first}T00:00:00Z`);
  const last = new Date(start.getTime() + (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from: first, to: last };
}

export function createCalendarExchange(calendar: CalendarStore, automations: ReturnType<typeof createAutomationsService>, validate: (definition: AutomationDefinition, calendarPaths: Set<string>, confirmed: boolean) => void) {
  function prepare(value: unknown, confirmed: boolean) {
    const bundle = parseCalendarBundle(value);
    const existingCalendars = new Set(calendar.lists().map((list) => list.id));
    const calendarIds = new Set([...existingCalendars, ...bundle.calendars.map((list) => list.id)]);
    const calendarPaths = new Set([...calendarIds].map((id) => calendarPathForListId(id)));
    const existingEvents = new Set(calendar.events().map((event) => event.id));
    const existingAutomations = new Set(automations.list().map((item) => item.id));
    const newCalendars = bundle.calendars.filter((list) => !existingCalendars.has(list.id));
    const newEvents = bundle.events.filter((event) => !existingEvents.has(event.id));
    const newAutomations = bundle.automations.filter((item) => !existingAutomations.has(item.id));
    for (const event of newEvents) if (!calendarIds.has(event.calendarId)) throw new Error(`Event "${event.title}" refers to an unknown calendar.`);
    for (const item of newAutomations) {
      if (item.enabled && item.recurrence.frequency === 'once' && nextOccurrences(item.recurrence, new Date(), 1).length === 0) throw new Error(`Automation "${item.name}" needs a future date and time.`);
      validate(item, calendarPaths, confirmed);
    }
    return {
      calendars: newCalendars,
      events: newEvents,
      automations: newAutomations,
      skipped: bundle.calendars.length + bundle.events.length + bundle.automations.length - newCalendars.length - newEvents.length - newAutomations.length,
    };
  }
  return {
    preview: (value: unknown, confirmed = false) => prepare(value, confirmed),
    apply: (value: unknown, confirmed = false) => {
      const plan = prepare(value, confirmed);
      for (const list of plan.calendars) calendar.saveList(list);
      for (const event of plan.events) calendar.saveEvent(event);
      for (const item of plan.automations) automations.save(item);
      return { calendars: plan.calendars.length, events: plan.events.length, automations: plan.automations.length, skipped: plan.skipped };
    },
    read: (from?: string, to?: string) => {
      const first = from ?? new Date().toLocaleDateString('en-CA');
      if (!validCalendarDate(first)) throw new Error('Use YYYY-MM-DD for the range start.');
      const start = new Date(`${first}T00:00:00Z`);
      const last = to ?? new Date(start.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
      if (!validCalendarDate(last)) throw new Error('Use YYYY-MM-DD for the range end.');
      const count = Math.round((new Date(`${last}T00:00:00Z`).getTime() - start.getTime()) / 86_400_000) + 1;
      if (count < 1 || count > 366) throw new Error('Read a date range of 1 to 366 days.');
      const days = Array.from({ length: count }, (_, index) => new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10));
      const schedules: CalendarEvent[] = automations.list().filter((item) => item.enabled).map((item) => ({
        id: `schedule:${item.id}`,
        calendarId: 'automation-schedules',
        title: item.name,
        date: item.recurrence.startDate,
        time: item.recurrence.localTime,
        allDay: false,
        timezone: item.recurrence.timezone,
        recurrence: item.recurrence,
        automationId: item.id,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
      const occurrences = [...eventsOnDays([...calendar.events(), ...schedules], days)].flatMap(([date, events]) => events.map((event) => ({ ...event, date })));
      return { calendars: calendar.lists(), automations: automations.list(), occurrences, from: first, to: last, template: calendarJsonTemplate() };
    },
  };
}

export { defaultConversationPath };
