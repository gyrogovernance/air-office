import { expect, test } from 'bun:test';
import { DEFAULT_TODAY_SETTINGS, readTodaySettings, writeTodaySettings, type TodayStorage } from '../../../../apps/web/src/settings/today-settings.store';

/** A memory stand-in for localStorage, so the read/write rules are exercised without a browser. */
const memoryStorage = (initial: Record<string, string> = {}): TodayStorage & { data: Record<string, string> } => {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string): string | null => data[key] ?? null,
    setItem: (key: string, value: string): void => { data[key] = value; },
  };
};

test('a stored edition preference written by an older version reads with the new fields defaulted', () => {
  const storage = memoryStorage({ 'air-office:today-settings': JSON.stringify({ interests: 'design', sections: ['front'] }) });
  const settings = readTodaySettings(storage);
  expect(settings.interests).toBe('design');
  expect(settings.source).toBe('curated');
  expect(settings.sections).toEqual(['front']);
  // New fields fall back to their defaults so an old record never breaks the edition.
  expect(settings.prompt).toBe('');
  expect(settings.skillIds).toEqual([]);
  expect(settings.toolIds).toBeNull();
});

test('a malformed or absent record falls back to the defaults instead of failing', () => {
  expect(readTodaySettings(memoryStorage({ 'air-office:today-settings': 'not json' }))).toEqual(DEFAULT_TODAY_SETTINGS);
  expect(readTodaySettings(memoryStorage({ 'air-office:today-settings': JSON.stringify([1, 2]) }))).toEqual(DEFAULT_TODAY_SETTINGS);
  expect(readTodaySettings(memoryStorage())).toEqual(DEFAULT_TODAY_SETTINGS);
  expect(readTodaySettings(null)).toEqual(DEFAULT_TODAY_SETTINGS);
});

test('a chosen tool list round-trips, and null keeps meaning every read-only tool', () => {
  const storage = memoryStorage();
  writeTodaySettings({ ...DEFAULT_TODAY_SETTINGS, toolIds: ['builtin:web-search'] }, storage);
  expect(readTodaySettings(storage).toolIds).toEqual(['builtin:web-search']);
  writeTodaySettings({ ...DEFAULT_TODAY_SETTINGS, toolIds: null }, storage);
  expect(readTodaySettings(storage).toolIds).toBeNull();
});

test('the reader can persist news search without losing other preferences', () => {
  const storage = memoryStorage();
  writeTodaySettings({ ...DEFAULT_TODAY_SETTINGS, source: 'search', interests: 'cycling' }, storage);
  expect(readTodaySettings(storage)).toMatchObject({ source: 'search', interests: 'cycling' });
});
