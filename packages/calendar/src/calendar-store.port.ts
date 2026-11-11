import type { CalendarEvent, CalendarList } from './calendar.domain.public';

/**
 * Persistence port for calendar lists and events. The service owns the
 * SQLite file; the UI reaches it only through the service routes, so the
 * renderer never holds a second copy of the schedule truth.
 */
export interface CalendarStore {
  lists(): CalendarList[];
  saveList(list: CalendarList): CalendarList;
  deleteList(id: string): void;
  events(calendarId?: string): CalendarEvent[];
  saveEvent(event: CalendarEvent): CalendarEvent;
  deleteEvent(id: string): void;
  clearPersonalData(): void;
  close(): void;
}
