import { describe, expect, test } from 'bun:test';
import { isChatRunSettings } from '@office/contracts/chat';
import type { RetrievalMode } from '@office/contracts/knowledge';
import {
  formatFlagValue,
  flagOptionLabel,
  parseFlagValue,
  resolveFlagState,
  searchSettingsFlags,
  settingsFlags,
  settingsSections,
} from '../../../apps/web/src/settings/settings.policy';
import {
  INSTANCE_SETTINGS_KEY,
  PERSONAL_SETTINGS_KEY,
  clearSettingsValue,
  knowledgeSearchOptions,
  noticeDurationMs,
  readSettingsValues,
  setSettingsValue,
  workspaceRestoresStage,
  type SettingsStorage,
} from '../../../apps/web/src/settings/settings.store';

function fakeStorage(initial: Record<string, string> = {}): SettingsStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function flag(id: string) {
  const found = settingsFlags.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing flag ${id}`);
  return found;
}

describe('settings section registry', () => {
  test('sections are listed in their group order', () => {
    expect(settingsSections.map((entry) => entry.id)).toEqual([
      'dashboard', 'profile', 'data',
      'cloud-ai', 'knowledge', 'prompt', 'skill', 'tools', 'today', 'preset', 'apps', 'craft',
      'advanced', 'references',
    ]);
    const groups = [...new Set(settingsSections.map((entry) => entry.group))];
    expect(groups).toEqual(['Personal', 'Office', 'General']);
  });

  test('every section carries a distinct label and a summary', () => {
    const labels = settingsSections.map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const entry of settingsSections) {
      expect(entry.summary.length).toBeGreaterThan(0);
    }
  });
});

describe('flag stored and effective values', () => {
  const personal: Record<string, unknown> = {};
  const instance: Record<string, unknown> = {};

  test('an unset flag falls back to its built-in default', () => {
    const state = resolveFlagState(flag('chat.temperature'), personal, instance);
    expect(state).toEqual({ stored: undefined, storedSet: false, storedValid: true, effective: 0.7, source: 'default' });
  });

  test('an instance default becomes effective until a personal value exists', () => {
    const state = resolveFlagState(flag('chat.temperature'), personal, { 'chat.temperature': 0.2 });
    expect(state.storedSet).toBe(false);
    expect(state.effective).toBe(0.2);
    expect(state.source).toBe('instance');
  });

  test('a personal value wins over the instance default and counts as stored', () => {
    const state = resolveFlagState(flag('chat.temperature'), { 'chat.temperature': 1.1 }, { 'chat.temperature': 0.2 });
    expect(state).toEqual({ stored: 1.1, storedSet: true, storedValid: true, effective: 1.1, source: 'personal' });
  });

  test('false and zero stored values are honored rather than treated as unset', () => {
    expect(resolveFlagState(flag('workspace.restore-stage'), { 'workspace.restore-stage': false }, {}).effective).toBe(false);
    expect(resolveFlagState(flag('workspace.restore-stage'), { 'workspace.restore-stage': false }, {}).source).toBe('personal');
    expect(resolveFlagState(flag('chat.temperature'), { 'chat.temperature': 0 }, {}).effective).toBe(0);
    expect(resolveFlagState(flag('chat.temperature'), { 'chat.temperature': 0 }, {}).source).toBe('personal');
  });

  test('an invalid stored value stays visible but never becomes effective', () => {
    const state = resolveFlagState(flag('chat.temperature'), { 'chat.temperature': 5 }, { 'chat.temperature': 0.2 });
    expect(state.stored).toBe(5);
    expect(state.storedSet).toBe(true);
    expect(state.storedValid).toBe(false);
    expect(state.effective).toBe(0.2);
    expect(state.source).toBe('instance');
    const stringState = resolveFlagState(flag('chat.temperature'), { 'chat.temperature': 'hot' }, {});
    expect(stringState.storedValid).toBe(false);
    expect(stringState.effective).toBe(0.7);
    expect(stringState.source).toBe('default');
  });

  test('a null stored value is invalid and recoverable through reset', () => {
    const state = resolveFlagState(flag('chat.temperature'), { 'chat.temperature': null }, {});
    expect(state.storedSet).toBe(true);
    expect(state.storedValid).toBe(false);
    expect(state.effective).toBe(0.7);
    const cleared = clearSettingsValue(PERSONAL_SETTINGS_KEY, 'chat.temperature', fakeStorage({ [PERSONAL_SETTINGS_KEY]: '{"chat.temperature":null}' }));
    expect('chat.temperature' in cleared).toBe(false);
  });

  test('an instance-scoped flag reports its value from the instance store', () => {
    const state = resolveFlagState(flag('knowledge.retrieval-mode'), {}, { 'knowledge.retrieval-mode': 'hybrid' });
    expect(state.stored).toBe('hybrid');
    expect(state.storedSet).toBe(true);
    expect(state.effective).toBe('hybrid');
    expect(state.source).toBe('instance');
    expect(formatFlagValue(flag('knowledge.retrieval-mode'), 'hybrid')).toBe('Hybrid');
    expect(formatFlagValue(flag('chat.temperature'), undefined)).toBe('Not set');
    expect(formatFlagValue(flag('workspace.restore-stage'), true)).toBe('On');
    expect(formatFlagValue(flag('workspace.restore-stage'), false)).toBe('Off');
    expect(flagOptionLabel(flag('knowledge.retrieval-mode'), 'full-text')).toBe('Full text');
    expect(flagOptionLabel(flag('web-search.region'), 'wt-wt')).toBe('Worldwide');
  });
});

describe('flag input validation against the chat run contract', () => {
  test('temperature bounds agree with isChatRunSettings', () => {
    const temperature = flag('chat.temperature');
    for (const value of [0, 0.7, 2, 2.1, -0.1, Number.NaN, '0.7', null]) {
      expect(parseFlagValue(temperature, value).ok).toBe(isChatRunSettings({ temperature: value as number }));
    }
  });

  test('maximum output token bounds agree with isChatRunSettings', () => {
    const tokens = flag('chat.max-output-tokens');
    for (const value of [1, 0, 1.5, 4096, -3, Number.NaN]) {
      expect(parseFlagValue(tokens, value).ok).toBe(isChatRunSettings({ maxOutputTokens: value as number }));
    }
  });

  test('enum, integer, and range rules reject out-of-contract values', () => {
    const retrieval = flag('knowledge.retrieval-mode');
    expect(parseFlagValue(retrieval, 'vector').ok).toBe(true);
    expect(parseFlagValue(retrieval, 'semantic').ok).toBe(false);
    expect(parseFlagValue(retrieval, 3).ok).toBe(false);
    const limit = flag('knowledge.search-limit');
    expect(parseFlagValue(limit, 10).ok).toBe(true);
    expect(parseFlagValue(limit, 10.5).ok).toBe(false);
    expect(parseFlagValue(limit, 0).ok).toBe(false);
    expect(parseFlagValue(limit, 51).ok).toBe(false);
    expect(parseFlagValue(flag('workspace.restore-stage'), 'true').ok).toBe(false);
  });
});

describe('settings record persistence', () => {
  test('values round-trip through the personal and instance records', () => {
    const store = fakeStorage();
    setSettingsValue(PERSONAL_SETTINGS_KEY, 'chat.temperature', 0.3, store);
    setSettingsValue(INSTANCE_SETTINGS_KEY, 'knowledge.search-limit', 25, store);
    expect(readSettingsValues(PERSONAL_SETTINGS_KEY, store)).toEqual({ 'chat.temperature': 0.3 });
    expect(readSettingsValues(INSTANCE_SETTINGS_KEY, store)).toEqual({ 'knowledge.search-limit': 25 });
    clearSettingsValue(PERSONAL_SETTINGS_KEY, 'chat.temperature', store);
    expect(readSettingsValues(PERSONAL_SETTINGS_KEY, store)).toEqual({});
    expect(readSettingsValues(INSTANCE_SETTINGS_KEY, store)).toEqual({ 'knowledge.search-limit': 25 });
  });

  test('corrupt or foreign payloads degrade to an empty record', () => {
    expect(readSettingsValues(PERSONAL_SETTINGS_KEY, fakeStorage({ [PERSONAL_SETTINGS_KEY]: 'not json' }))).toEqual({});
    expect(readSettingsValues(PERSONAL_SETTINGS_KEY, fakeStorage({ [PERSONAL_SETTINGS_KEY]: '[]' }))).toEqual({});
    expect(readSettingsValues(PERSONAL_SETTINGS_KEY, fakeStorage({ [PERSONAL_SETTINGS_KEY]: '"text"' }))).toEqual({});
    expect(readSettingsValues(PERSONAL_SETTINGS_KEY, null)).toEqual({});
  });

  test('writes without a storage adapter still report the intended record', () => {
    expect(setSettingsValue(PERSONAL_SETTINGS_KEY, 'chat.temperature', 0.9, null)).toEqual({ 'chat.temperature': 0.9 });
    expect(clearSettingsValue(PERSONAL_SETTINGS_KEY, 'chat.temperature', null)).toEqual({});
  });
});

describe('settings that running features read', () => {
  test('knowledge search starts from the built-in defaults', () => {
    const store = fakeStorage();
    expect(knowledgeSearchOptions(store)).toEqual({ mode: 'full-text', limit: 10 });
    expect(workspaceRestoresStage(store)).toBe(true);
    expect(noticeDurationMs(store)).toBe(4000);
  });

  test('stored instance and personal values reach the dependent actions', () => {
    const store = fakeStorage({
      [INSTANCE_SETTINGS_KEY]: JSON.stringify({ 'knowledge.retrieval-mode': 'hybrid', 'knowledge.search-limit': 50, 'workspace.notice-duration': 12 }),
      [PERSONAL_SETTINGS_KEY]: JSON.stringify({ 'workspace.restore-stage': false }),
    });
    expect(knowledgeSearchOptions(store)).toEqual({ mode: 'hybrid', limit: 50 });
    expect(workspaceRestoresStage(store)).toBe(false);
    expect(noticeDurationMs(store)).toBe(12000);
  });

  test('a personal override changes the value the search action sends', () => {
    const store = fakeStorage({ [PERSONAL_SETTINGS_KEY]: JSON.stringify({ 'knowledge.search-limit': 5 }) });
    expect(knowledgeSearchOptions(store)).toEqual({ mode: 'full-text', limit: 5 });
  });

  test('invalid stored values fall back to the built-in defaults', () => {
    const store = fakeStorage({
      [INSTANCE_SETTINGS_KEY]: JSON.stringify({ 'knowledge.retrieval-mode': 'semantic', 'knowledge.search-limit': 999 }),
      [PERSONAL_SETTINGS_KEY]: JSON.stringify({ 'workspace.notice-duration': 0 }),
    });
    expect(knowledgeSearchOptions(store)).toEqual({ mode: 'full-text', limit: 10 });
    expect(noticeDurationMs(store)).toBe(4000);
  });
});

describe('contract coverage of the settings surface', () => {
  test('chat run settings and retrieval modes from the contracts are exposed as flags', () => {
    expect(settingsFlags.map((item) => item.id)).toContain('chat.temperature');
    expect(settingsFlags.map((item) => item.id)).toContain('chat.max-output-tokens');
    expect(settingsFlags.map((item) => item.id)).toContain('chat.slash-commands');
    expect(settingsSections.map((item) => item.id)).toContain('apps');
    const retrieval = flag('knowledge.retrieval-mode');
    const modes: RetrievalMode[] = ['vector', 'full-text', 'hybrid'];
    expect([...(retrieval.options ?? [])].sort()).toEqual([...modes].sort());
    expect(flag('chat.temperature').min).toBe(0);
    expect(flag('chat.temperature').max).toBe(2);
  });

  test('advanced flag search covers identifiers, labels, and help text', () => {
    expect(searchSettingsFlags('').map((item) => item.id)).toEqual(settingsFlags.map((item) => item.id));
    expect(searchSettingsFlags('temperature').map((item) => item.id)).toEqual(['chat.temperature']);
    expect(searchSettingsFlags('knowledge.retrieval-mode').map((item) => item.id)).toEqual(['knowledge.retrieval-mode']);
    expect(searchSettingsFlags('reload').map((item) => item.id)).toEqual(['workspace.restore-stage']);
    expect(searchSettingsFlags('no-such-flag')).toEqual([]);
  });
});
