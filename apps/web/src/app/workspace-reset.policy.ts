const CONTENT_KEYS = [
  'air-office:browser-files',
  'air-office:scope-id',
  'air-office:authorized-root',
  'air-office:markdown-rich-edits',
  'air-office:stage-state-v1',
  'air-office:stage-tabs-v1',
  'air-office:active-stage-tab',
  'air-office:attached-methods',
  'air-office:app-source-draft',
  'air-office:app-source-drafts',
  'air-office:active-conversation'
] as const;

const CONTENT_KEY_PREFIXES = [
  'air-office:draft:',
  'air-office:chat-draft:',
  'air-office:chat-settings:',
  'air-office:chat-tools:',
  'air-office:chat-ratings:',
  'air-office:chat-graph:'
] as const;

export function switchBrowserWorkspaceContent(enabled: boolean, local: Storage = localStorage, session: Storage = sessionStorage): void {
  const localStorage = local;
  const sessionStorage = session;
  const current = localStorage.getItem('office.development.demo') === 'on';
  if (current === enabled) return;
  const archiveKey = (demo: boolean) => `air-office:workspace-browser-state:${demo ? 'demo' : 'personal'}`;
  const owned = (key: string) => CONTENT_KEYS.some((value) => value === key) || CONTENT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
  const snapshot: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key && owned(key)) snapshot[key] = localStorage.getItem(key)!;
  }
  const restored: Record<string, string> = JSON.parse(localStorage.getItem(archiveKey(enabled)) ?? '{}');
  localStorage.setItem(archiveKey(current), JSON.stringify(snapshot));
  clearBrowserWorkspaceContent(localStorage);
  clearBrowserWorkspaceContent(sessionStorage);
  for (const [key, value] of Object.entries(restored)) if (owned(key) && typeof value === 'string') localStorage.setItem(key, value);
  localStorage.removeItem(archiveKey(enabled));
  if (enabled) localStorage.setItem('office.development.demo', 'on');
  else localStorage.removeItem('office.development.demo');
}

/** Removes browser-persisted workspace content and recovery data while retaining preferences. */
export function clearBrowserWorkspaceContent(storage: Storage): void {
  const keysToRemove = new Set<string>(CONTENT_KEYS);
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && CONTENT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) keysToRemove.add(key);
  }
  for (const key of keysToRemove) storage.removeItem(key);
}
