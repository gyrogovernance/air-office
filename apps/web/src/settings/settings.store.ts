import type { RetrievalMode } from '@office/contracts/knowledge';
import { resolveFlagState, settingsFlags, type SettingsFlag, type SettingsFlagValue } from './settings.policy';

export const PERSONAL_SETTINGS_KEY = 'air-office:settings-personal';
export const INSTANCE_SETTINGS_KEY = 'air-office:instance-defaults';

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): SettingsStorage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function readSettingsValues(key: string, storage: SettingsStorage | null = browserStorage()): Record<string, unknown> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch { return {}; }
}

export function writeSettingsValues(key: string, values: Record<string, unknown>, storage: SettingsStorage | null = browserStorage()): void {
  try { storage?.setItem(key, JSON.stringify(values)); } catch { /* Settings stay readable when storage is full. */ }
}

export function setSettingsValue(key: string, flagId: string, value: unknown, storage: SettingsStorage | null = browserStorage()): Record<string, unknown> {
  const values = readSettingsValues(key, storage);
  values[flagId] = value;
  writeSettingsValues(key, values, storage);
  return values;
}

export function clearSettingsValue(key: string, flagId: string, storage: SettingsStorage | null = browserStorage()): Record<string, unknown> {
  const values = readSettingsValues(key, storage);
  delete values[flagId];
  writeSettingsValues(key, values, storage);
  return values;
}

function findFlag(flagId: string): SettingsFlag | undefined {
  return settingsFlags.find((flag) => flag.id === flagId);
}

export function resolveStoredFlag(flag: SettingsFlag, storage: SettingsStorage | null = browserStorage()) {
  return resolveFlagState(flag, readSettingsValues(PERSONAL_SETTINGS_KEY, storage), readSettingsValues(INSTANCE_SETTINGS_KEY, storage));
}

export function effectiveFlagValue(flagId: string, storage: SettingsStorage | null = browserStorage()): SettingsFlagValue | undefined {
  const flag = findFlag(flagId);
  return flag ? resolveStoredFlag(flag, storage).effective : undefined;
}

/** Collection search options the service receives, resolved from the stored flags. */
export function knowledgeSearchOptions(storage: SettingsStorage | null = browserStorage()): { mode: RetrievalMode; limit: number } {
  const mode = effectiveFlagValue('knowledge.retrieval-mode', storage);
  const limit = effectiveFlagValue('knowledge.search-limit', storage);
  return {
    mode: mode === 'vector' || mode === 'hybrid' || mode === 'full-text' ? mode : 'full-text',
    limit: typeof limit === 'number' && Number.isSafeInteger(limit) ? limit : 10,
  };
}

export function workspaceRestoresStage(storage: SettingsStorage | null = browserStorage()): boolean {
  return effectiveFlagValue('workspace.restore-stage', storage) !== false;
}

export function noticeDurationMs(storage: SettingsStorage | null = browserStorage()): number {
  const seconds = effectiveFlagValue('workspace.notice-duration', storage);
  return (typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : 4) * 1000;
}

export function chatSlashCommandsEnabled(storage: SettingsStorage | null = browserStorage()): boolean {
  return effectiveFlagValue('chat.slash-commands', storage) !== false;
}
