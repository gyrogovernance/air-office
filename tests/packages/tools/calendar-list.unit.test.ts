import { describe, expect, test } from 'bun:test';
import { listCalendarEvents } from '../../../packages/tools/src/calendar-list.policy';

describe('calendar_list', () => {
  test('filters by path and date window then sorts', () => {
    const result = listCalendarEvents({
      events: [
        { id: '1', calendarId: 'work', title: 'Later', date: '2026-11-10', time: '15:00', allDay: false, timezone: 'UTC' },
        { id: '2', calendarId: 'work', title: 'Soon', date: '2026-11-08', time: '09:00', allDay: false, timezone: 'UTC' },
        { id: '3', calendarId: 'home', title: 'Home', date: '2026-11-09', allDay: true, timezone: 'UTC' },
      ],
      pathForCalendarId: (id) => `calendar/${id}.ics`,
      from: '2026-11-08',
      to: '2026-11-09T23:59:59',
      calendarPath: 'calendar/work.ics',
      limit: 10,
    });
    expect(result.events.map((event) => event.title)).toEqual(['Soon']);
    expect(result.events[0]?.path).toBe('calendar/work.ics');
    expect(result.events[0]?.start).toBe('2026-11-08T09:00:00');
  });
});
