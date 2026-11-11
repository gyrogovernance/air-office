import { afterAll, expect, test } from 'bun:test';
import { createConversationGraph, type ConversationGraph } from '@office/chat/domain';
import type { ConversationClient } from '../../../../apps/web/src/chat/conversation-client.adapter';
import '../../../support/web-dom.adapter';


const { act, StrictMode, useMemo } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { GlassScene, GlassContent } = await import('@glass-sdk/liquid-glass');
const { useChatRuntime } = await import('../../../../apps/web/src/chat/chat-runtime.hook');
const { ChatRail } = await import('../../../../apps/web/src/chat/chat-rail.component');
const { EMPTY_CONTEXT_SELECTION } = await import('../../../../apps/web/src/chat/composer-context.policy');

/** Clipboard payload the copy actions must land in. */
const clipboardWrites: string[] = [];
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: (text: string) => { clipboardWrites.push(text); return Promise.resolve(); } }
});

const CONVERSATION_ID = 'conv-copy';

function copyGraph(): ConversationGraph {
  const base = createConversationGraph(CONVERSATION_ID, 'Copy acceptance');
  const at = new Date().toISOString();
  return { ...base, messages: [
    { id: 'u1', conversationId: CONVERSATION_ID, parentId: null, role: 'user', content: 'hello clipboard', complete: true, runId: null, createdAt: at, modelId: null, modelIndex: 0, output: [], statusHistory: [], usage: null, error: null, files: [], attachments: [] },
    { id: 'a1', conversationId: CONVERSATION_ID, parentId: 'u1', role: 'assistant', content: 'assistant reply text', complete: true, runId: 'run-1', createdAt: at, modelId: 'local-replay', modelIndex: 0, output: [], statusHistory: [], usage: null, error: null, files: [], attachments: [] }
  ] };
}

function stubClient(graphs: Map<string, ConversationGraph>): ConversationClient {
  return {
    async folders() { return []; },
    async createFolder(input) { return { id: input.id, name: input.name, parentId: input.parentId ?? null, instruction: '', createdAt: '', updatedAt: '' }; },
    async updateFolder(id, patch) { return { id, name: patch.name ?? id, parentId: patch.parentId ?? null, instruction: '', createdAt: '', updatedAt: '' }; },
    async deleteFolder() {},
    async list() { return [...graphs.values()].map((graph) => ({ id: graph.conversation.id, title: graph.conversation.title, updatedAt: graph.conversation.updatedAt, messageCount: graph.messages.length, pinned: false, archivedAt: null, tags: [], folderId: null, unreadAt: null })); },
    async load(conversationId) { return graphs.get(conversationId) ?? null; },
    async historyPage(conversationId, options = {}) {
      const graph = graphs.get(conversationId);
      if (!graph) return null;
      return {
        conversation: graph.conversation,
        messages: graph.messages,
        hasEarlier: false,
        hasLater: false,
        leafId: options.leafId ?? graph.messages.at(-1)?.id ?? null,
      };
    },
    async create(conversationId) { const graph = createConversationGraph(conversationId); graphs.set(conversationId, graph); return graph; },
    async update(conversationId, update) {
      const graph = graphs.get(conversationId);
      if (!graph) throw new Error('missing');
      const next = { ...graph, conversation: { ...graph.conversation, ...(update.title !== undefined ? { title: update.title } : {}) } };
      graphs.set(conversationId, next);
      return next;
    },
    async remove(conversationId) { graphs.delete(conversationId); },
    async appendTurn(input) {
      await this.appendMessage({ conversationId: input.conversationId, id: input.userId, parentId: input.parentId, role: 'user', content: input.content, complete: true, attachments: input.attachments });
      return this.appendMessage({ conversationId: input.conversationId, id: input.assistantId, parentId: input.userId, role: 'assistant', content: '', complete: false });
    },
    async deleteMessages(conversationId, messageIds) {
      const graph = graphs.get(conversationId);
      if (!graph) throw new Error('missing');
      graphs.set(conversationId, { ...graph, messages: graph.messages.filter((message) => !messageIds.includes(message.id)) });
    },
    async appendMessage(input) {
      const graph = graphs.get(input.conversationId);
      if (!graph) throw new Error('missing');
      const next = { ...graph, messages: [...graph.messages, { id: input.id, conversationId: input.conversationId, parentId: input.parentId, role: input.role, content: input.content, complete: input.complete, runId: input.runId ?? null, createdAt: new Date().toISOString(), modelId: null, modelIndex: 0, output: [], statusHistory: [], usage: null, error: null, files: [], attachments: [] }] };
      graphs.set(input.conversationId, next);
      return next;
    },
    async updateMessage(conversationId, messageId, patch) {
      const graph = graphs.get(conversationId);
      if (!graph) throw new Error('missing');
      const next = { ...graph, messages: graph.messages.map((item) => item.id === messageId ? { ...item, ...(patch as object) } : item) };
      graphs.set(conversationId, next);
      return next;
    },
    async search() { return []; }
  };
}

const noopKnowledge = {
  collections: [], documents: [], versions: [], artifact: null, results: [], jobs: [], embeddingModel: '', setEmbeddingModel: async () => {}, rebuildCollection: async () => {}, indexStatus: async () => ({ current: null, configured: { model: '', dimensions: 0, metric: 'cosine', chunkerVersion: 'char-window-v1' }, rebuildRequired: false }), indexStatuses: {}, status: '', error: '',
  ingest: async () => {}, createCollection: async () => {}, updateCollection: async () => {}, deleteCollection: async () => {}, selectDocument: async () => {}, openCitation: async () => {},
  inspectExtraction: async () => {}, indexVersion: async () => {}, cancelJob: async () => {}, search: async () => {}, refresh: async () => {}
};

function waitFor(predicate: () => boolean, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) { resolve(); return; }
      if (Date.now() - started > 5000) { reject(new Error(`timed out waiting for ${label}`)); return; }
      setTimeout(tick, 20);
    };
    tick();
  });
}

test('Elements Thread mounts messages and copies assistant text', async () => {
  const graphs = new Map<string, ConversationGraph>([[CONVERSATION_ID, copyGraph()]]);
  window.localStorage.setItem('air-office:active-conversation', CONVERSATION_ID);

  function Harness() {
    const conversations = useMemo(() => stubClient(graphs), []);
    const runtime = useChatRuntime({
      client: { request: async () => new Response(null, { status: 404 }) } as never,
      conversations,
      buildRequest: async (turns) => ({ runId: 'run-1', model: 'local-replay', messages: turns }),
      getContext: () => '',
      onError: () => {},
      onNotice: () => {}
    });
    return <ChatRail
      appearance="light" runtime={runtime} selection="" onClearDocumentProposal={() => {}}
      onInsertIntoNote={() => {}} attached={[]} attachedInstructions=""
      missingVariables={[]} promptValues={{}} onPromptValue={() => {}} onDetachAll={() => {}}
      agentKnowledgePreview="" knowledge={noopKnowledge}
      contextSelection={EMPTY_CONTEXT_SELECTION} onContextSelectionChange={() => {}}
      models={[{ value: 'local-replay', label: 'Local replay' }]} selectedModel="local-replay" onSelectModel={() => {}}
      agents={[]} selectedAgent="" onSelectAgent={() => {}}
      activeFileName={null}/>;
  }

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<StrictMode><MemoryRouter initialEntries={[`/chat/${CONVERSATION_ID}`]}><GlassScene appearance="light" material="regular" maxSurfaces={4}><GlassContent aria-hidden="true"/><Harness/></GlassScene></MemoryRouter></StrictMode>); });
    await act(async () => { await waitFor(() => host.querySelector('.aui-thread-root') !== null, 'Elements Thread root'); });
    await act(async () => { await waitFor(() => host.querySelector('[data-slot="aui_user-message-root"]') !== null, 'user message'); });
    await act(async () => { await waitFor(() => host.querySelector('[data-slot="aui_assistant-message-root"]') !== null, 'assistant message'); });
    expect(host.querySelector('[data-slot="aui_composer-shell"]')).not.toBeNull();

    const copyAssistant = [...host.querySelectorAll<HTMLButtonElement>('[data-slot="aui_assistant-message-root"] button')]
      .find((button) => button.textContent?.includes('Copy')) ?? null;
    expect(copyAssistant).not.toBeNull();
    await act(async () => { copyAssistant!.click(); });
    expect(clipboardWrites).toContain('assistant reply text');
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    window.localStorage.removeItem('air-office:active-conversation');
  }
});
