import { expect, test } from 'bun:test';
import type { ConversationGraph, ConversationMessage } from '@office/chat/domain';
import { HISTORY_CACHE_MAX, HISTORY_PAGE_SIZE, prependHistoryPage, replaceHistoryWindow, windowPathHeadId } from '../../../../apps/web/src/chat/chat-history-window.policy';

function message(id: string, parentId: string | null, index: number): ConversationMessage {
  return {
    id,
    conversationId: 'c1',
    parentId,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: id,
    complete: true,
    runId: null,
    createdAt: new Date(1_000 + index).toISOString(),
    modelId: null,
    modelIndex: 0,
    output: [],
    statusHistory: [],
    usage: null,
    error: null,
    files: [],
    attachments: [],
  };
}

function graphWith(count: number): ConversationGraph {
  const messages: ConversationMessage[] = [];
  for (let index = 0; index < count; index++) {
    messages.push(message(`m${index}`, index === 0 ? null : `m${index - 1}`, index));
  }
  return {
    conversation: {
      id: 'c1',
      title: 'Chat',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      pinned: false,
      archivedAt: null,
      tags: [],
      folderId: null,
      unreadAt: null,
    },
    messages,
  };
}

test('replaceHistoryWindow caps retained messages and reports earlier overflow', () => {
  const source = graphWith(HISTORY_CACHE_MAX + 40);
  const result = replaceHistoryWindow(source.conversation, source.messages, { hasEarlier: false, hasLater: false });
  expect(result.graph.messages).toHaveLength(HISTORY_CACHE_MAX);
  expect(result.hasEarlier).toBe(true);
  expect(result.graph.messages[0]?.id).toBe(`m${40}`);
});

test('prependHistoryPage merges older messages and drops newest when over the cache cap', () => {
  const current: ConversationGraph = {
    ...graphWith(1),
    messages: Array.from({ length: 30 }, (_, index) => message(`n${index}`, index === 0 ? null : `n${index - 1}`, index + 1_000)),
  };
  const earlier = graphWith(HISTORY_CACHE_MAX).messages;
  const result = prependHistoryPage(current, earlier, { hasEarlier: false, hasLater: false });
  expect(result.graph.messages.length).toBe(HISTORY_CACHE_MAX);
  expect(result.hasLater).toBe(true);
  expect(result.graph.messages[0]?.id).toBe('m0');
  expect(result.graph.messages.some((item) => item.id.startsWith('n'))).toBe(false);
});

test('windowPathHeadId returns the oldest retained path message', () => {
  const graph = graphWith(5);
  expect(windowPathHeadId(graph, 'm4')).toBe('m0');
  expect(windowPathHeadId(graph, null)).toBeNull();
});
