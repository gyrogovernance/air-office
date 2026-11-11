export const PROFILE_SETTINGS_KEY = 'air-office:profile';

export interface ProfileSettings {
  name: string;
  photo: string;
}

export interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const EMPTY_PROFILE: ProfileSettings = { name: '', photo: '' };

function browserStorage(): ProfileStorage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** Reads the stored profile, degrading to an empty one when the payload is unusable. */
export function readProfile(storage: ProfileStorage | null = browserStorage()): ProfileSettings {
  if (!storage) return { ...EMPTY_PROFILE };
  try {
    const raw = storage.getItem(PROFILE_SETTINGS_KEY);
    if (!raw) return { ...EMPTY_PROFILE };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...EMPTY_PROFILE };
    const record = parsed as Record<string, unknown>;
    return {
      name: typeof record.name === 'string' ? record.name : '',
      photo: typeof record.photo === 'string' ? record.photo : '',
    };
  } catch { return { ...EMPTY_PROFILE }; }
}

/** Stores the profile, keeping only the fields the profile owns. */
export function writeProfile(profile: ProfileSettings, storage: ProfileStorage | null = browserStorage()): void {
  try { storage?.setItem(PROFILE_SETTINGS_KEY, JSON.stringify({ name: profile.name, photo: profile.photo })); } catch { /* The profile stays readable when storage is full. */ }
}
