import { describe, expect, test } from 'bun:test';
import { eventsOnDays, monthGridDays, nextOccurrences, validateCalendarEvent, validateCalendarList, validateRecurrence, weekDays } from '../../../packages/calendar/src/calendar.domain.public';
import type { CalendarEvent, Recurrence } from '../../../packages/calendar/src/calendar.domain.public';

describe('calendar recurrence', () => {
  test('keeps the selected local time across a daylight saving transition', () => {
    const recurrence: Recurrence = { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'Europe/Athens', startDate: '2026-03-28' };
    const dates = nextOccurrences(recurrence, new Date('2026-03-27T00:00:00Z'), 3);
    expect(dates.map((date) => date.toISOString())).toEqual([
      '2026-03-28T07:00:00.000Z',
      '2026-03-29T06:00:00.000Z',
      '2026-03-30T06:00:00.000Z'
    ]);
  });

  test('rejects invalid timezone and impossible local time', () => {
    expect(validateRecurrence({ frequency: 'daily', interval: 1, weekdays: [], localTime: '25:00', timezone: 'Europe/Athens', startDate: '2026-01-01' })).toBe(false);
    expect(validateRecurrence({ frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'Mars/Olympus', startDate: '2026-01-01' })).toBe(false);
  });

  test('runs a repeated local time once at the earlier daylight-saving instant', () => {
    const recurrence: Recurrence = { frequency: 'daily', interval: 1, weekdays: [], localTime: '03:30', timezone: 'Europe/Athens', startDate: '2026-10-25' };
    const [occurrence] = nextOccurrences(recurrence, new Date('2026-10-24T00:00:00Z'), 1);
    expect(occurrence?.toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });
});

// ===== Calendar events (CHAT-197/198/199)

function sampleEvent(patch: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e1', calendarId: 'c1', title: 'Review', date: '2026-10-15', allDay: false, time: '09:00',
    timezone: 'Europe/Athens', createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z',
    ...patch
  };
}

describe('calendar events domain', () => {
  test('month grids always cover six weeks and mark out-of-month days', () => {
    const grid = monthGridDays(2026, 10);
    expect(grid).toHaveLength(42);
    expect(grid[0]!.date).toBe('2026-09-28');
    expect(grid.filter((day) => day.inMonth)).toHaveLength(31);
    const week = weekDays('2026-10-15');
    expect(week[0]).toBe('2026-10-12');
    expect(week.at(-1)).toBe('2026-10-18');
  });

  test('event validation requires a real date, a valid wall time, and a known timezone', () => {
    expect(validateCalendarEvent(sampleEvent({}))).toBe(true);
    expect(validateCalendarEvent(sampleEvent({ allDay: true, time: undefined }))).toBe(true);
    expect(validateCalendarEvent(sampleEvent({ allDay: true, time: '09:00' }))).toBe(false);
    expect(validateCalendarEvent(sampleEvent({ time: '25:00' }))).toBe(false);
    expect(validateCalendarEvent(sampleEvent({ date: '2026-02-30' }))).toBe(false);
    expect(validateCalendarEvent(sampleEvent({ timezone: 'Mars/Olympus' }))).toBe(false);
    expect(validateCalendarEvent(sampleEvent({ title: '' }))).toBe(false);
    expect(validateCalendarEvent(sampleEvent({ reminderMinutes: -1 }))).toBe(false);
  });

  test('calendar list validation requires a name and an rgb hex color', () => {
    expect(validateCalendarList({ id: 'c1', name: 'Work', color: '#3478db', visible: true, createdAt: 'x', updatedAt: 'x' })).toBe(true);
    expect(validateCalendarList({ id: 'c1', name: 'Work', color: 'blue', visible: true, createdAt: 'x', updatedAt: 'x' })).toBe(false);
    expect(validateCalendarList({ id: 'c1', name: '', color: '#3478db', visible: true, createdAt: 'x', updatedAt: 'x' })).toBe(false);
  });

  test('places single events on their day and recurring events across the window', () => {
    const days = weekDays('2026-10-15');
    const weekly: CalendarEvent = sampleEvent({
      id: 'e2', title: 'Weekly sync', date: '2026-10-13',
      recurrence: { frequency: 'weekly', interval: 1, weekdays: [2], localTime: '10:00', timezone: 'Europe/Athens', startDate: '2026-10-13' }
    });
    const placed = eventsOnDays([sampleEvent({}), weekly], days);
    expect(placed.get('2026-10-15')?.map((item) => item.id)).toEqual(['e1']);
    // The weekly recurrence lands on Tuesday 2026-10-13 inside this Monday-start week.
    expect(placed.get('2026-10-13')?.map((item) => item.id)).toEqual(['e2']);
  });

  test('a daily recurrence fills consecutive grid days', () => {
    const days = monthGridDays(2026, 10).filter((day) => day.inMonth).map((day) => day.date).slice(0, 5);
    const daily: CalendarEvent = sampleEvent({
      id: 'e3', title: 'Standup', date: '2026-10-01',
      recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'Europe/Athens', startDate: '2026-10-01' }
    });
    const placed = eventsOnDays([daily], days);
    expect(placed.get('2026-10-01')).toHaveLength(1);
    expect(placed.get('2026-10-05')).toHaveLength(1);
  });
});
