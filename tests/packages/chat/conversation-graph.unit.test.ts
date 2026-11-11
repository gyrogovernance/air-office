import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultConversationStore } from '../../../packages/chat/src/chat.service.public';
import { activeLeaf, appendMessage, branchFromEdit, conversationTurns, createConversationGraph, deriveTitle, messagePath } from '../../../packages/chat/src/conversation-graph.entity';

function withVaultConversations() {
  const scratch = mkdtempSync(join(tmpdir(), 'air-conversation-'));
  process.env.AIR_VAULT_ROOT = scratch;
  const store = createVaultConversationStore(scratch);
  return {
    scratch,
    store,
    close: () => {
      store.close();
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}

test('a message path follows parent references from root to leaf', () => {
  let graph = createConversationGraph('c1');
  graph = appendMessage(graph, { id: 'u1', parentId: null, role: 'user', content: 'question', complete: true });
  graph = appendMessage(graph, { id: 'a1', parentId: 'u1', role: 'assistant', content: 'answer', complete: true });
  expect(messagePath(graph, 'a1').map((message) => message.id)).toEqual(['u1', 'a1']);
  expect(activeLeaf(graph)).toBe('a1');
});

test('editing a message branches: the original and its descendants stay reachable', () => {
  let graph = createConversationGraph('c1');
  graph = appendMessage(graph, { id: 'u1', parentId: null, role: 'user', content: 'first', complete: true });
  graph = appendMessage(graph, { id: 'a1', parentId: 'u1', role: 'assistant', content: 'answer', complete: true });
  graph = branchFromEdit(graph, 'u1', 'edited', 'u2', '2020-01-01T00:00:00.000Z');
  expect(graph.messages).toHaveLength(3);
  expect(messagePath(graph, 'a1').map((message) => message.id)).toEqual(['u1', 'a1']);
  expect(messagePath(graph, 'u2').map((message) => message.id)).toEqual(['u2']);
});

test('appending a duplicate id is a no-op so a replayed event does not duplicate', () => {
  let graph = createConversationGraph('c1');
  graph = appendMessage(graph, { id: 'u1', parentId: null, role: 'user', content: 'question', complete: true });
  graph = appendMessage(graph, { id: 'u1', parentId: null, role: 'user', content: 'question', complete: true });
  expect(graph.messages).toHaveLength(1);
});

test('the title derives from the first user message only once', () => {
  let graph = createConversationGraph('c1');
  graph = appendMessage(graph, { id: 'u1', parentId: null, role: 'user', content: 'How do I restore a draft?', complete: true });
  graph = deriveTitle(graph);
  graph = deriveTitle(graph);
  expect(graph.conversation.title).toBe('How do I restore a draft?');
});

test('vault retains conversation graph, branches and titles across reopen', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-conversation-'));
  process.env.AIR_VAULT_ROOT = scratch;
  let store = createVaultConversationStore(scratch);
  try {
    store.appendMessage({ conversationId: 'c1', id: 'u1', parentId: null, role: 'user', content: 'first', complete: true });
    store.appendMessage({ conversationId: 'c1', id: 'a1', parentId: 'u1', role: 'assistant', content: 'partial', complete: false, runId: 'run-1' });
    store.rename('c1', 'Named conversation');
    store.close();
    store = createVaultConversationStore(scratch);
    const graph = store.load('c1')!;
    expect(graph.conversation.title).toBe('Named conversation');
    expect(graph.messages).toHaveLength(2);
    expect(graph.messages[1]?.complete).toBe(false);
    expect(graph.messages[1]?.parentId).toBe('u1');
    expect(store.summaries(10)).toEqual([{ id: 'c1', title: 'Named conversation', updatedAt: graph.conversation.updatedAt, messageCount: 2, pinned: false, archivedAt: null, tags: [], folderId: null, unreadAt: null }]);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('history pages forward without losing earlier messages', () => {
  const fixture = withVaultConversations();
  try {
    const { store } = fixture;
    for (let index = 0; index < 250; index++) store.appendMessage({ conversationId: 'c1', id: `m${index}`, parentId: index === 0 ? null : `m${index - 1}`, role: 'user', content: `message ${index}`, complete: true, createdAt: new Date(1000 + index).toISOString() });
    const first = store.history('c1', null, 100);
    expect(first).toHaveLength(100);
    const second = store.history('c1', first.at(-1)!.id, 100);
    expect(second).toHaveLength(100);
    expect(second[0]?.id).toBe('m100');
    expect(store.history('c1', null, 1000)).toHaveLength(200);
  } finally { fixture.close(); }
});

test('meta.yaml without optional sidebar fields keeps conversations loadable', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-conversation-'));
  process.env.AIR_VAULT_ROOT = scratch;
  const chatDir = join(scratch, 'programs', 'general', 'chats', 'c1');
  mkdirSync(chatDir, { recursive: true });
  writeFileSync(join(chatDir, 'meta.yaml'), Bun.YAML.stringify({
    title: 'Old conversation',
    pinned: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }));
  writeFileSync(join(chatDir, 'messages.jsonl'), `${JSON.stringify({ id: 'm1', conversationId: 'c1', parentId: null, role: 'user', content: 'kept', complete: true, runId: null, createdAt: '2024-01-01T00:00:00.000Z', modelIndex: 0 })}\n`);
  const store = createVaultConversationStore(scratch);
  try {
    const graph = store.load('c1')!;
    expect(graph.conversation.title).toBe('Old conversation');
    expect(graph.conversation.pinned).toBe(false);
    expect(graph.conversation.archivedAt).toBeNull();
    expect(graph.conversation.tags).toEqual([]);
    expect(graph.conversation.folderId).toBeNull();
    expect(graph.messages[0]?.content).toBe('kept');
    expect(graph.messages[0]?.modelIndex).toBe(0);
    store.setMeta('c1', { pinned: true, tags: ['kept'] });
    store.close();
    const reopened = createVaultConversationStore(scratch);
    expect(reopened.load('c1')?.conversation.pinned).toBe(true);
    expect(reopened.load('c1')?.conversation.tags).toEqual(['kept']);
    reopened.close();
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('structured output, usage, error and attachments survive a reopen', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-conversation-'));
  process.env.AIR_VAULT_ROOT = scratch;
  let store = createVaultConversationStore(scratch);
  try {
    store.appendMessage({
      conversationId: 'c1', id: 'a1', parentId: null, role: 'assistant', content: 'answer', complete: true, runId: 'run-1',
      modelId: 'gpt:test', modelIndex: 1,
      output: [{ kind: 'reasoning', text: 'thinking' }, { kind: 'text', text: 'answer' }],
      statusHistory: [{ at: '2026-01-01T00:00:00.000Z', label: 'searching', state: 'ok' }],
      usage: { inputTokens: 12, outputTokens: 34 },
      error: { code: 'provider-timeout', message: 'slow', retryable: true },
      files: ['doc-1'],
      attachments: [{ id: 'att-1', kind: 'note', label: 'Notes' }]
    });
    store.close();
    store = createVaultConversationStore(scratch);
    const message = store.load('c1')!.messages[0]!;
    expect(message.modelId).toBe('gpt:test');
    expect(message.modelIndex).toBe(1);
    expect(message.output).toHaveLength(2);
    expect(message.output[0]?.kind).toBe('reasoning');
    expect(message.statusHistory[0]?.label).toBe('searching');
    expect(message.usage).toEqual({ inputTokens: 12, outputTokens: 34 });
    expect(message.error?.code).toBe('provider-timeout');
    expect(message.files).toEqual(['doc-1']);
    expect(message.attachments[0]?.kind).toBe('note');
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('sidebar metadata applies per conversation and archived ones hide from search', () => {
  const fixture = withVaultConversations();
  try {
    const { store } = fixture;
    store.appendMessage({ conversationId: 'c1', id: 'm1', parentId: null, role: 'user', content: 'aurora report', complete: true });
    store.appendMessage({ conversationId: 'c2', id: 'm2', parentId: null, role: 'user', content: 'unrelated text', complete: true });
    store.setMeta('c1', { pinned: true, folderId: 'f1', unreadAt: '2026-01-01T00:00:00.000Z' });
    const pinned = store.summaries(10).find((summary) => summary.id === 'c1')!;
    expect(pinned.pinned).toBe(true);
    expect(pinned.folderId).toBe('f1');
    expect(pinned.unreadAt).toBe('2026-01-01T00:00:00.000Z');
    expect(store.summaries(10)[0]?.id).toBe('c1');
    expect(store.search('aurora').map((result) => result.id)).toEqual(['c1']);
    expect(store.search('aurora')[0]?.matchedMessageIds).toEqual(['m1']);
    store.setMeta('c1', { archivedAt: '2026-01-02T00:00:00.000Z' });
    expect(store.search('aurora')).toHaveLength(0);
    expect(store.search('aurora', { includeArchived: true }).map((result) => result.id)).toEqual(['c1']);
  } finally { fixture.close(); }
});


test('reloaded structured tool output becomes valid provider history', () => {
  let graph = createConversationGraph('structured');
  graph = appendMessage(graph, { id: 'user', parentId: null, role: 'user', content: 'Read status', complete: true });
  graph = appendMessage(graph, { id: 'answer', parentId: 'user', role: 'assistant', content: 'Ready', complete: true, output: [{ kind: 'tool', toolCallId: 'status-call', name: 'read_status', arguments: { scope: 'local' }, result: { state: 'ready' }, status: 'ok' }] });
  expect(conversationTurns(graph.messages)).toEqual([
    { role: 'user', content: 'Read status' },
    { role: 'assistant-tool-calls', content: '', calls: [{ toolCallId: 'status-call', name: 'read_status', arguments: { scope: 'local' } }] },
    { role: 'tool', toolCallId: 'status-call', content: '{"state":"ready"}' },
    { role: 'assistant', content: 'Ready' }
  ]);
});

test('conversation summaries page past the old listing cap', () => {
  const fixture = withVaultConversations();
  try {
    const { store } = fixture;
    const total = 250;
    for (let index = 0; index < total; index++) store.ensure(`page-${String(index).padStart(4, '0')}`);
    const pages = [...store.summaries(100), ...store.summaries(100, 100), ...store.summaries(100, 200)];
    expect(pages).toHaveLength(total);
    expect(new Set(pages.map((row) => row.id)).size).toBe(total);
    expect(pages.some((row) => row.id === 'page-0249')).toBe(true);
    store.setMeta('page-0249', { folderId: 'late-folder', tags: ['late-tag'] });
    expect(store.summaries(1, 0, { folderId: 'late-folder', tag: 'late-tag' }).map((row) => row.id)).toEqual(['page-0249']);
  } finally { fixture.close(); }
}, { timeout: 30_000 });


test('search modifiers combine tags, pin, archive, folder and literal text', () => {
  const fixture = withVaultConversations();
  try {
    const { store } = fixture;
    store.ensure('matching');
    store.appendMessage({ conversationId: 'matching', id: 'matching-user', parentId: null, role: 'user', content: '100% evidence', complete: true });
    store.setMeta('matching', { pinned: true, tags: ['audit'], folderId: 'program:research-notes', archivedAt: '2026-10-14T00:00:00Z' });
    store.ensure('other');
    store.appendMessage({ conversationId: 'other', id: 'other-user', parentId: null, role: 'user', content: '1000 evidence', complete: true });
    expect(store.search('tag:audit pinned:true archived:true folder:program:research-notes 100%').map((row) => row.id)).toEqual(['matching']);
    expect(store.search('archived:false 100%')).toEqual([]);
    expect(store.search('pinned:false evidence').map((row) => row.id)).toEqual(['other']);
  } finally { fixture.close(); }
});
