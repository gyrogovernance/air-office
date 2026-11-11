import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultConversationStore, pageConversationHistory } from '../../../packages/chat/src/chat.service.public';

afterEach(() => {
  delete process.env.AIR_VAULT_ROOT;
});

function withStore() {
  const root = mkdtempSync(join(tmpdir(), 'air-history-'));
  process.env.AIR_VAULT_ROOT = root;
  return { root, store: createVaultConversationStore(root), close: () => { rmSync(root, { recursive: true, force: true }); } };
}

test('history page opens on the newest path window and pages earlier', () => {
  const fixture = withStore();
  try {
    const { store } = fixture;
    store.ensure('c1');
    for (let index = 0; index < 120; index++) {
      store.appendMessage({
        conversationId: 'c1',
        id: `m${index}`,
        parentId: index === 0 ? null : `m${index - 1}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `message ${index}`,
        complete: true,
        createdAt: new Date(1_000 + index).toISOString(),
      });
    }
    const newest = store.historyPage('c1', { limit: 50, fromEnd: true });
    expect(newest).not.toBeNull();
    expect(newest!.messages).toHaveLength(50);
    expect(newest!.messages[0]?.id).toBe('m70');
    expect(newest!.messages.at(-1)?.id).toBe('m119');
    expect(newest!.hasEarlier).toBe(true);
    expect(newest!.hasLater).toBe(false);

    const earlier = store.historyPage('c1', { limit: 50, before: newest!.messages[0]!.id });
    expect(earlier!.messages).toHaveLength(50);
    expect(earlier!.messages[0]?.id).toBe('m20');
    expect(earlier!.messages.at(-1)?.id).toBe('m69');
    expect(earlier!.hasEarlier).toBe(true);
    expect(earlier!.hasLater).toBe(true);
  } finally {
    fixture.close();
  }
});

test('history page keeps sibling messages for branch pickers without the rest of the tree', () => {
  const fixture = withStore();
  try {
    const { store } = fixture;
    store.ensure('c1');
    store.appendMessage({ conversationId: 'c1', id: 'u1', parentId: null, role: 'user', content: 'one', complete: true, createdAt: '2024-01-01T00:00:00.000Z' });
    store.appendMessage({ conversationId: 'c1', id: 'a1', parentId: 'u1', role: 'assistant', content: 'first', complete: true, createdAt: '2024-01-01T00:00:01.000Z' });
    store.appendMessage({ conversationId: 'c1', id: 'a2', parentId: 'u1', role: 'assistant', content: 'second', complete: true, createdAt: '2024-01-01T00:00:02.000Z' });
    store.appendMessage({ conversationId: 'c1', id: 'u2', parentId: 'a2', role: 'user', content: 'follow', complete: true, createdAt: '2024-01-01T00:00:03.000Z' });
    store.appendMessage({ conversationId: 'c1', id: 'a3', parentId: 'u2', role: 'assistant', content: 'done', complete: true, createdAt: '2024-01-01T00:00:04.000Z' });
    // Abandoned root stays out unless the window itself includes a root fork.
    store.appendMessage({ conversationId: 'c1', id: 'dead-u', parentId: null, role: 'user', content: 'other root', complete: true, createdAt: '2023-01-01T00:00:00.000Z' });
    store.appendMessage({ conversationId: 'c1', id: 'dead-a', parentId: 'dead-u', role: 'assistant', content: 'other', complete: true, createdAt: '2023-01-01T00:00:01.000Z' });

    const page = pageConversationHistory(store.load('c1')!, { limit: 3, fromEnd: true, leafId: 'a3' });
    const ids = page.messages.map((message) => message.id);
    expect(ids).toContain('a1');
    expect(ids).toContain('a2');
    expect(ids).toContain('a3');
    expect(ids).not.toContain('dead-u');
    expect(ids).not.toContain('dead-a');
    // Newest three path messages are a2,u2,a3; a1 is hydrated as a2's sibling.
    expect(ids).not.toContain('u1');
  } finally {
    fixture.close();
  }
});

test('loadMeta reads conversation without messages', () => {
  const fixture = withStore();
  try {
    const { store } = fixture;
    store.ensure('c1');
    store.appendMessage({ conversationId: 'c1', id: 'm1', parentId: null, role: 'user', content: 'hi', complete: true });
    const meta = store.loadMeta('c1');
    expect(meta?.id).toBe('c1');
    expect(meta?.title).toBe('New conversation');
  } finally {
    fixture.close();
  }
});
