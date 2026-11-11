import { describe, expect, test } from 'bun:test';
import { clearBrowserWorkspaceContent, switchBrowserWorkspaceContent } from '../../../apps/web/src/app/workspace-reset.policy';

function fakeStorage(entries: Record<string, string>): Storage & { values: Map<string, string> } {
  const values = new Map(Object.entries(entries));
  return {
    values,
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }
  };
}

describe('browser workspace reset policy', () => {
  test('demo switching keeps personal imports and drafts separate', () => {
    const local = fakeStorage({ 'air-office:browser-files': 'personal', 'air-office:theme': 'dark' });
    const session = fakeStorage({});
    switchBrowserWorkspaceContent(true, local, session);
    expect(local.getItem('air-office:browser-files')).toBeNull();
    local.setItem('air-office:browser-files', 'demo');
    clearBrowserWorkspaceContent(local);
    switchBrowserWorkspaceContent(false, local, session);
    expect(local.getItem('air-office:browser-files')).toBe('personal');
    switchBrowserWorkspaceContent(true, local, session);
    expect(local.getItem('air-office:browser-files')).toBeNull();
    expect(local.getItem('air-office:theme')).toBe('dark');
  });
  test('removes workspace content, stage state, attachments and every draft or recovery key', () => {
    const storage = fakeStorage({
      'air-office:browser-files': 'files',
      'air-office:scope-id': 'scope',
      'air-office:authorized-root': 'folder',
      'air-office:markdown-rich-edits': 'rich edits',
      'air-office:stage-state-v1': 'stage',
      'air-office:stage-tabs-v1': 'legacy stage',
      'air-office:active-stage-tab': 'tab',
      'air-office:attached-methods': 'methods',
      'air-office:draft:file-1': 'draft',
      'air-office:draft:file-1:source': 'source recovery',
      'air-office:draft:file-1:rich-before-source-edit': 'rich recovery',
      'air-office:draft:file-1:rich': 'rich draft',
      'air-office:draft:file-1:original-source': 'original source',
      'air-office:draft:file-1:source-backup:backup-id': 'source backup',
      'air-office:app-source-draft': 'legacy app draft',
      'air-office:app-source-drafts': 'app drafts',
      'air-office:chat-draft:conversation-1': 'chat draft',
      'air-office:active-conversation': 'missing-chat',
      'air-office:chat-settings:conversation-1': 'settings',
      'air-office:chat-tools:conversation-1': 'tools',
      'air-office:chat-ratings:conversation-1': 'ratings',
      'air-office:chat-graph:conversation-1': 'graph',
      'air-office:theme': 'dark',
      'air-office:left-width': '320',
      'unrelated-preference': 'keep'
    });
    clearBrowserWorkspaceContent(storage);
    expect([...storage.values.keys()].sort()).toEqual(['air-office:left-width', 'air-office:theme', 'unrelated-preference']);
  });

  test('does not delete similarly named keys outside the owned content scope', () => {
    const storage = fakeStorage({
      'air-office:browser-files-backup': 'keep',
      'air-office:drafts:export': 'keep',
      'air-office:chat-draft-backup': 'keep',
      'air-office:theme': 'system',
      'air-office:left-mode': 'files',
      'air-office:right-mode': 'chat',
      'air-office:left-width': '300',
      'air-office:right-width': '400',
      'air-office:files-open': '1',
      'air-office:chat-open': '0',
      'air-office:explorer-expanded': '[]',
      'air-office:settings-personal': '{}',
      'air-office:instance-defaults': '{}'
    });
    const original = [...storage.values];
    clearBrowserWorkspaceContent(storage);
    clearBrowserWorkspaceContent(storage);
    expect([...storage.values]).toEqual(original);
    expect(Object.fromEntries(storage.values)).toMatchObject({
      'air-office:browser-files-backup': 'keep',
      'air-office:drafts:export': 'keep',
      'air-office:chat-draft-backup': 'keep',
      'air-office:theme': 'system'
    });
  });
});
