import { describe, expect, test } from 'bun:test';
import type { ConversationGraph, ConversationSearchResult, ConversationSummary } from '@office/chat/domain';
import { createConversationClient, type ConversationClient } from '../../../../apps/web/src/chat/conversation-client.adapter';

function fakeClient(calls: string[] = []): ConversationClient {
  const graph: ConversationGraph = { conversation: { id: 'c', title: 't', createdAt: '', updatedAt: '', pinned: false, archivedAt: null, tags: [], folderId: null, unreadAt: null }, messages: [] };
  return {
    async folders() { return []; },
    async createFolder(input) { return { id: input.id, name: input.name, parentId: input.parentId ?? null, instruction: input.instruction ?? '', createdAt: '', updatedAt: '' }; },
    async updateFolder(id, patch) { return { id, name: patch.name ?? 'folder', parentId: patch.parentId ?? null, instruction: patch.instruction ?? '', createdAt: '', updatedAt: '' }; },
    async deleteFolder(id, policy) { calls.push(`deleteFolder:${id}:${policy}`); },
    async list() { calls.push('list'); return [] as ConversationSummary[]; },
    async load() { calls.push('load'); return graph; },
    async historyPage(id) { calls.push(`historyPage:${id}`); return { conversation: graph.conversation, messages: [], hasEarlier: false, hasLater: false, leafId: null }; },
    async create(id) { calls.push(`create:${id}`); return graph; },
    async update(id, update) { calls.push(`update:${id}:${JSON.stringify(update)}`); return graph; },
    async remove(id) { calls.push(`delete:${id}`); },
    async deleteMessages(id, messageIds) { calls.push(`deleteMessages:${id}:${messageIds.join(',')}`); },
    async appendMessage(input) { calls.push(`append:${input.conversationId}:${input.id}:${input.parentId ?? 'root'}:${input.role}`); return graph; },
    async appendTurn(input) { calls.push(`turn:${input.conversationId}:${input.userId}:${input.assistantId}`); return graph; },
    async updateMessage() { calls.push('updateMessage'); return graph; },
    async search() { calls.push('search'); return [] as ConversationSearchResult[]; }
  };
}

describe('service-backed conversation client', () => {
  test('creates folders only with an explicit stable id', async () => {
    const calls: string[] = [];
    const client = createConversationClient({
      base: 'http://127.0.0.1:4317',
      token: async () => 't',
      json: async <T>(path: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${path} ${String(init?.body ?? '')}`);
        return { folder: { id: 'folder-1', name: 'Research', parentId: null, instruction: 'Be precise.', createdAt: '', updatedAt: '' } } as T;
      },
      request: async () => new Response(null, { status: 204 })
    });
    const folder = await client.createFolder({ id: 'folder-1', name: 'Research', instruction: 'Be precise.' });
    expect(folder.id).toBe('folder-1');
    expect(calls[0]).toContain('"id":"folder-1"');
  });

  test('deletes chats only when the explicit delete policy is selected', async () => {
    const calls: string[] = [];
    await fakeClient(calls).deleteFolder('folder-1', 'keep-chats');
    await fakeClient(calls).deleteFolder('folder-2', 'delete-chats');
    expect(calls).toEqual(['deleteFolder:folder-1:keep-chats', 'deleteFolder:folder-2:delete-chats']);
  });

  test('posts message payloads without the conversation path field', async () => {
    const lines: string[] = [];
    const client = createConversationClient({
      base: 'http://127.0.0.1:4317',
      token: async () => 't',
      json: async <T>(path: string, init?: RequestInit) => {
        lines.push(`${init?.method ?? 'GET'} ${path} ${String(init?.body ?? '')}`);
        return { conversation: { messages: [] } } as T;
      },
      request: async () => new Response(null, { status: 204 })
    });
    await client.appendMessage({ conversationId: 'c1', id: 'm1', parentId: null, role: 'user', content: 'hello', complete: true });
    expect(lines[0]).toContain('POST /api/v1/conversations/c1/messages');
    expect(lines[0]).not.toContain('conversationId');
    expect(lines[0]).toContain('"content":"hello"');
  });
});
