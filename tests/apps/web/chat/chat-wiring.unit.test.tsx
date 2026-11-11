import { afterAll, expect, spyOn, test } from 'bun:test';
import type { AppendMessage, ExternalStoreAdapter, ThreadMessageLike } from '@assistant-ui/react';
import { createConversationGraph, pageConversationHistory } from '@office/chat/domain';
import type { ConversationGraph } from '@office/chat/domain';
import type { ChatRunRequest } from '@office/contracts/chat';
import type { ConversationClient } from '../../../../apps/web/src/chat/conversation-client.adapter';
import type { ChatRuntime } from '../../../../apps/web/src/chat/chat-runtime.hook';
import { HISTORY_PAGE_SIZE } from '../../../../apps/web/src/chat/chat-history-window.policy';
import '../../../support/web-dom.adapter';


const { act, StrictMode, useMemo } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter, useLocation, useNavigate } = await import('react-router-dom');
const { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime } = await import('@assistant-ui/react');
const { StreamdownTextPrimitive } = await import('@assistant-ui/react-streamdown');
const { useChatRuntime } = await import('../../../../apps/web/src/chat/chat-runtime.hook');

const HOSTILE = [
  '<script>window.__xss = true</script>',
  '<img src="x" onerror="window.__xss = true">',
  '<svg onload="window.__xss = true"></svg>',
  '[click me](javascript:window.__xss = true)',
  '<a href="javascript:window.__xss = true">phish</a>'
].join('\n\n');

function message(id: string, role: 'user' | 'assistant', content: string): ThreadMessageLike {
  return role === 'user'
    ? { id, role, content }
    : { id, role, content, status: { type: 'complete', reason: 'stop' } };
}

function FixtureThread(props: { messages: ThreadMessageLike[] }) {
  const adapter: ExternalStoreAdapter<ThreadMessageLike> = {
    messages: props.messages,
    convertMessage: (item) => item,
    onNew: async () => undefined
  };
  const runtime = useExternalStoreRuntime(adapter);
  return <AssistantRuntimeProvider runtime={runtime}>
    <ThreadPrimitive.Root>
      <ThreadPrimitive.Viewport>
        <ThreadPrimitive.Messages>
          {({ message: row }) => <article data-message-id={row.id}>
            <MessagePrimitive.Parts components={{ Text: () => <StreamdownTextPrimitive/> }}/>
          </article>}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  </AssistantRuntimeProvider>;
}

test('a fixture store renders the thread without executing hostile content', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<StrictMode><FixtureThread messages={[message('u1', 'user', 'show me'), message('a1', 'assistant', HOSTILE)]}/></StrictMode>);
    });
    const rendered = host.querySelector('article[data-message-id="a1"]');
    expect(rendered).not.toBeNull();
    expect(rendered!.textContent ?? '').toContain('click me');
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('[onerror],[onload]')).toBeNull();
    expect([...host.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'))).not.toContain('javascript:window.__xss = true');
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined();
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

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
      const page = pageConversationHistory(graph, {
        limit: options.limit ?? HISTORY_PAGE_SIZE,
        ...(options.before ? { before: options.before } : options.after !== undefined ? { after: options.after } : { fromEnd: options.fromEnd !== false }),
        ...(options.leafId ? { leafId: options.leafId } : {}),
      });
      return {
        conversation: graph.conversation,
        messages: page.messages,
        hasEarlier: page.hasEarlier,
        hasLater: page.hasLater,
        leafId: page.leafId,
      };
    },
    async create(conversationId) {
      const graph = createConversationGraph(conversationId);
      graphs.set(conversationId, graph);
      return graph;
    },
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
      const next = {
        ...graph,
        messages: [...graph.messages, {
          id: input.id, conversationId: input.conversationId, parentId: input.parentId, role: input.role,
          content: input.content, complete: input.complete, runId: input.runId ?? null,
          createdAt: new Date().toISOString(), modelId: null, modelIndex: 0, output: [],
          statusHistory: [], usage: null, error: null, files: [], attachments: []
        }]
      };
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

test('New chat opens a saved conversation route instead of returning to Welcome', async () => {
  const graphs = new Map<string, ConversationGraph>();
  let current: ChatRuntime | null = null;
  let pathname = '';
  function Harness() {
    const location = useLocation();
    pathname = location.pathname;
    const conversations = useMemo(() => stubClient(graphs), []);
    current = useChatRuntime({
      client: { request: async () => new Response(null, { status: 404 }) } as never,
      conversations,
      buildRequest: async (turns): Promise<ChatRunRequest> => ({ runId: 'unused', model: 'local-replay', messages: turns }),
      getContext: () => '',
      onError: () => {},
      onNotice: () => {}
    });
    return null;
  }

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<StrictMode><MemoryRouter initialEntries={['/settings/dashboard']}><Harness/></MemoryRouter></StrictMode>); });
    await act(async () => {
      current!.newConversation();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(pathname).toMatch(/^\/chat\/[A-Za-z0-9_-]+$/);
    expect(current!.conversationId).toBe(pathname.split('/')[2]);
    expect(graphs.has(current!.conversationId!)).toBe(true);
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test('app navigation and reload keep the active conversation without creating another', async () => {
  const graphs = new Map<string, ConversationGraph>([['existing-chat', createConversationGraph('existing-chat')]]);
  let current: ChatRuntime | null = null;
  let navigate: (path: string) => void = () => {};
  let pathname = '';
  function Harness() {
    pathname = useLocation().pathname;
    navigate = useNavigate();
    const conversations = useMemo(() => stubClient(graphs), []);
    current = useChatRuntime({
      client: { request: async () => new Response(null, { status: 404 }) } as never,
      conversations,
      buildRequest: async (turns): Promise<ChatRunRequest> => ({ runId: 'unused', model: 'local-replay', messages: turns }),
      getContext: () => '', onError: () => {}, onNotice: () => {}
    });
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  let root = createRoot(host);
  try {
    window.localStorage.setItem('air-office:active-conversation', 'existing-chat');
    await act(async () => { root.render(<MemoryRouter initialEntries={['/chat/existing-chat']}><Harness/></MemoryRouter>); });
    expect(current!.conversationId).toBe('existing-chat');
    await act(async () => { navigate('/apps/prompts'); });
    expect(pathname).toBe('/apps/prompts');
    expect(current!.conversationId).toBe('existing-chat');
    expect(graphs.size).toBe(1);
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await act(async () => { root.render(<MemoryRouter initialEntries={['/apps/prompts']}><Harness/></MemoryRouter>); });
    expect(pathname).toBe('/apps/prompts');
    expect(current!.conversationId).toBe('existing-chat');
    expect(graphs.size).toBe(1);
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    window.localStorage.removeItem('air-office:active-conversation');
  }
});

const encoder = new TextEncoder();

function sseFrame(type: string, payload: Record<string, unknown>) {
  return `data: ${JSON.stringify({ protocolVersion: 1, eventId: `e-${type}`, runId: 'run-1', correlationId: 'c', sequence: 1, timestamp: new Date().toISOString(), type, payload })}\n\n`;
}

test('composer send reaches the run stream and stop cancels it', async () => {
  const graphs = new Map<string, ConversationGraph>();
  const seen: { method: string; path: string; body?: string }[] = [];
  let releaseStream: (() => void) | null = null;
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    seen.push({ method: init?.method ?? 'GET', path: url.pathname, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.pathname === '/health') return Response.json({ ready: true });
    if (url.pathname === '/bootstrap') return Response.json({ token: 'test-session', serviceBase: 'http://127.0.0.1:4317' });
    if (url.pathname === '/api/v1/runs' && (init?.method ?? 'GET') === 'POST') {
      return Response.json({ events: '/api/v1/runs/run-1/events', cancel: '/api/v1/runs/run-1' });
    }
    if (url.pathname === '/api/v1/runs/run-1/events') {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseFrame('text-delta', { messageId: 'a1', text: 'streamed hello' })));
          let closed = false;
          releaseStream = () => { if (!closed) { closed = true; controller.close(); } };
          init?.signal?.addEventListener('abort', () => releaseStream?.(), { once: true });
        }
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    }
    throw new Error(`Unexpected test request ${init?.method ?? 'GET'} ${url.pathname}`);
  }, { preconnect: globalThis.fetch.preconnect }));

  let current: ChatRuntime | null = null;
  function Harness() {
    const conversations = useMemo(() => stubClient(graphs), []);
    const runtime = useChatRuntime({
      client: { request: async () => new Response(null, { status: 404 }) } as never,
      conversations,
      buildRequest: async (turns): Promise<ChatRunRequest> => ({ runId: 'run-1', model: 'local-replay', messages: turns }),
      getContext: () => '',
      onError: () => {},
      onNotice: () => {}
    });
    current = runtime;
    return null;
  }

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<StrictMode><MemoryRouter><Harness/></MemoryRouter></StrictMode>); });
    expect(current).not.toBeNull();
    await act(async () => {
      await current!.adapter.onNew({ role: 'user', content: 'hello', parentId: null, sourceId: null, runConfig: undefined } as unknown as AppendMessage);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const runPost = seen.find((entry) => entry.path === '/api/v1/runs' && entry.method === 'POST');
    expect(runPost).toBeDefined();
    expect(runPost!.body ?? '').toContain('local-replay');
    expect(seen.some((entry) => entry.path === '/api/v1/runs/run-1/events')).toBe(true);
    expect(current!.sending).toBe(true);
    await act(async () => { current!.stop(); });
    function closeStream() { releaseStream?.(); }
    closeStream();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(current!.sending).toBe(false);
  } finally {
    fetchMock.mockRestore();
    await act(async () => { root.unmount(); });
    host.remove();
  }
});
