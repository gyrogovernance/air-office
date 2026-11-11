export type CalendarListEventInput = {
  id: string;
  calendarId: string;
  title: string;
  date: string;
  time?: string;
  allDay: boolean;
  timezone: string;
};

export type CalendarListHit = {
  path: string;
  title: string;
  start: string;
  end?: string;
};

function eventStart(event: CalendarListEventInput): string {
  if (event.allDay || !event.time) return `${event.date}T00:00:00`;
  return `${event.date}T${event.time}:00`;
}

/** Upcoming events sorted by start, optionally filtered by calendar path and date window. */
export function listCalendarEvents(input: {
  events: readonly CalendarListEventInput[];
  pathForCalendarId: (calendarId: string) => string;
  from?: string;
  to?: string;
  calendarPath?: string;
  limit?: number;
}): { events: CalendarListHit[] } {
  const limit = Number.isFinite(Number(input.limit)) ? Math.min(Math.max(Math.trunc(Number(input.limit)), 1), 100) : 25;
  const from = input.from?.trim() || undefined;
  const to = input.to?.trim() || undefined;
  const calendarPath = input.calendarPath?.trim().replace(/\\/g, '/') || undefined;
  const hits = input.events
    .map((event) => {
      const path = input.pathForCalendarId(event.calendarId);
      const start = eventStart(event);
      return { path, title: event.title, start } satisfies CalendarListHit;
    })
    .filter((hit) => {
      if (calendarPath && hit.path.replace(/\\/g, '/') !== calendarPath) return false;
      if (from && hit.start < from) return false;
      if (to && hit.start > to) return false;
      return true;
    })
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, limit);
  return { events: hits };
}
