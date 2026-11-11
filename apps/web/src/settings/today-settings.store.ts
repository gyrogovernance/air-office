/** The reader's preferences for their daily edition, stored under one key. */

export const TODAY_SETTINGS_KEY = 'air-office:today-settings';

export interface TodaySettings {
  /** Null follows the current chat model. */
  model: { providerId: string; modelId: string } | null;
  source: 'curated' | 'search';
  /** Free-text interests the editor should favour (e.g. "design systems, EU policy"). */
  interests: string;
  /** Section ids from SECTIONS the edition includes. */
  sections: string[];
  /** The reader's standing instruction — folded into every edition's prompt. */
  prompt: string;
  /** Skill ids folded into the edition's instructions; empty means none. */
  skillIds: string[];
  /** Tool ids the edition may read while printing. null means every enabled read-only tool; an empty list allows none. */
  toolIds: string[] | null;
}

export interface TodayStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const ALL_SECTIONS = ['front', 'world', 'day', 'reading'];

export const DEFAULT_TODAY_SETTINGS: TodaySettings = { model: null, source: 'curated', interests: '', sections: ['day'], prompt: '', skillIds: [], toolIds: null };

function browserStorage(): TodayStorage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** Reads the stored edition preferences; absent or partial values fall back to defaults. */
export function readTodaySettings(storage: TodayStorage | null = browserStorage()): TodaySettings {
  if (!storage) return { ...DEFAULT_TODAY_SETTINGS };
  try {
    const raw = storage.getItem(TODAY_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_TODAY_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_TODAY_SETTINGS };
    const record = parsed as Record<string, unknown>;
    const model = record.model && typeof record.model === 'object' && 'providerId' in record.model && typeof record.model.providerId === 'string' && record.model.providerId && 'modelId' in record.model && typeof record.model.modelId === 'string' && record.model.modelId ? { providerId: record.model.providerId, modelId: record.model.modelId } : null;
    const idList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
    return {
      model,
      source: record.source === 'search' ? 'search' : 'curated',
      interests: typeof record.interests === 'string' ? record.interests : '',
      sections: Array.isArray(record.sections) ? record.sections.filter((s): s is string => typeof s === 'string' && ALL_SECTIONS.includes(s)) : [...ALL_SECTIONS],
      prompt: typeof record.prompt === 'string' ? record.prompt : '',
      skillIds: idList(record.skillIds),
      toolIds: Array.isArray(record.toolIds) ? idList(record.toolIds) : null
    };
  } catch { return { ...DEFAULT_TODAY_SETTINGS }; }
}

export function writeTodaySettings(settings: TodaySettings, storage: TodayStorage | null = browserStorage()): void {
  try { storage?.setItem(TODAY_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* preferences stay readable when storage is full */ }
}
