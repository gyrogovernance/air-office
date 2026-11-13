import type { ServiceClient } from '../shared/service-client.hook';
import { STATIC_DEMO_SERVICE_BASE } from './static-demo.flag';
import snapshot from './demo-snapshot.json';

type Snapshot = {
  version: number;
  health: { ready?: boolean; demo?: boolean; protocol?: number };
  bootstrap: unknown;
  routes: Record<string, unknown>;
  documentsByKey: Record<string, unknown>;
  conversationsById: Record<string, unknown>;
  conversationHistoryById: Record<string, unknown>;
  scopeMaterial: Record<string, unknown>;
};

const STATIC_BASE = STATIC_DEMO_SERVICE_BASE;
const source = snapshot as Snapshot;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function jsonResponse(body: unknown, status = 200): Response {
  if (body === undefined) return new Response(null, { status: status === 200 ? 204 : status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function pathnameOf(path: string): { pathname: string; search: string } {
  const url = new URL(path, STATIC_BASE);
  return { pathname: url.pathname.replace(/\/$/, '') || '/', search: url.search };
}

function emptyFor(pathname: string): unknown {
  if (pathname.endsWith('/roots') || pathname.includes('/external/roots')) return { roots: [] };
  if (pathname.includes('/trash')) return { documents: [] };
  if (pathname.includes('/conversations')) return { conversations: [] };
  if (pathname.includes('/folders')) return { folders: [] };
  if (pathname.includes('/methods')) return { definitions: [] };
  if (pathname.includes('/automations')) return { automations: [] };
  if (pathname.includes('/calendar/lists')) return { lists: [] };
  if (pathname.includes('/calendar/events')) return { events: [] };
  if (pathname.includes('/lab/apps')) return { apps: [] };
  if (pathname.includes('/lab/glossary')) return { entries: [] };
  if (pathname.includes('/providers')) return { providers: [] };
  if (pathname.includes('/tools/connections')) return { connections: [] };
  if (pathname.includes('/tools')) return { defaultChatToolIds: [], chatAvailableToolIds: [] };
  if (pathname.includes('/model-connections')) return { connections: [] };
  if (pathname.includes('/model-catalog')) return { models: [] };
  if (pathname.includes('/crafts')) return { crafts: [] };
  if (pathname.includes('/collections')) return { collections: [] };
  if (pathname.includes('/market/catalog')) return { items: [] };
  if (pathname.includes('/market/sources')) return { sources: [] };
  if (pathname.includes('/memory')) return { items: [] };
  if (pathname.includes('/rich-documents')) return { documents: [] };
  if (pathname.endsWith('/documents') || pathname.includes('/documents/')) return { documents: [] };
  if (pathname.includes('/knowledge/embedding-model')) return { model: '', revision: '', dimensions: 0, mode: 'demo' };
  if (pathname.includes('/knowledge/index-status')) return { current: null, configured: { model: '', dimensions: 0, metric: '', chunkerVersion: '' }, rebuildRequired: false };
  if (pathname.includes('/workspace/nodes')) return { nodes: [] };
  if (pathname.includes('/search')) return { results: [] };
  if (pathname.includes('/jobs')) return { jobs: [] };
  return {};
}

function createState() {
  return {
    routes: clone(source.routes),
    documentsByKey: clone(source.documentsByKey),
    conversationsById: clone(source.conversationsById),
    conversationHistoryById: clone(source.conversationHistoryById),
    scopeMaterial: clone(source.scopeMaterial),
    nodes: clone((source.routes['GET /api/v1/workspace/nodes'] as { nodes: unknown[] } | undefined)?.nodes ?? []),
  };
}

/** Shared in-memory copy so every createServiceClient() sees the same demo data. */
let state = createState();

function conversationIdFrom(pathname: string): string | null {
  const match = pathname.match(/^\/api\/v1\/conversations\/([^/]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function documentKeyFrom(pathname: string): string | null {
  const match = pathname.match(/^\/api\/v1\/rich-documents\/(.+)$/);
  if (!match) return null;
  const key = decodeURIComponent(match[1]!);
  if (key === 'trash') return null;
  return key.replace(/\/restore$/, '');
}

function handle(method: string, path: string, bodyText?: string): Response {
  const { pathname } = pathnameOf(path);
  const upper = method.toUpperCase();
  const routeKey = `${upper} ${pathname}`;

  if (pathname === '/health') return jsonResponse(clone(source.health));
  if (pathname === '/bootstrap' && upper === 'POST') {
    return jsonResponse({ token: 'static-demo', protocol: 1, serviceBase: STATIC_BASE, demo: true });
  }

  if (upper === 'GET' && state.routes[routeKey] !== undefined) return jsonResponse(clone(state.routes[routeKey]));
  if (upper === 'GET' && pathname === '/api/v1/conversations') {
    return jsonResponse(clone(state.routes['GET /api/v1/conversations'] ?? { conversations: [] }));
  }
  if (upper === 'GET' && pathname === '/api/v1/cloud/chatgpt/status') {
    return jsonResponse(clone(state.routes['GET /api/v1/cloud/chatgpt/status'] ?? { accounts: [] }));
  }

  const documentKey = documentKeyFrom(pathname);
  if (documentKey && upper === 'GET') {
    const found = state.documentsByKey[documentKey];
    if (found) return jsonResponse(clone(found));
    return jsonResponse({ error: { message: 'Document not found.' } }, 404);
  }
  if (documentKey && upper === 'DELETE') {
    delete state.documentsByKey[documentKey];
    return jsonResponse({ ok: true });
  }
  if (pathname === '/api/v1/rich-documents' && upper === 'POST') {
    const document = bodyText ? JSON.parse(bodyText) as { id?: string; path?: string } : {};
    const id = document.id ?? crypto.randomUUID();
    const stored = { document: { ...document, id, path: document.path ?? id, updatedAt: new Date().toISOString() } };
    state.documentsByKey[id] = stored;
    if (document.path) state.documentsByKey[document.path] = stored;
    const list = (state.routes['GET /api/v1/rich-documents'] as { documents: unknown[] } | undefined) ?? { documents: [] };
    list.documents = [...list.documents.filter((item) => !(item && typeof item === 'object' && 'id' in item && (item as { id: string }).id === id)), stored.document];
    state.routes['GET /api/v1/rich-documents'] = list;
    return jsonResponse(stored);
  }

  const conversationId = conversationIdFrom(pathname);
  if (conversationId && pathname.endsWith('/history') && upper === 'GET') {
    const history = state.conversationHistoryById[conversationId];
    if (history) return jsonResponse(clone(history));
    return jsonResponse({ conversation: null, messages: [], hasEarlier: false, hasLater: false, leafId: null });
  }
  if (conversationId && upper === 'GET' && (pathname === `/api/v1/conversations/${conversationId}` || pathname === `/api/v1/conversations/${encodeURIComponent(conversationId)}`)) {
    const graph = state.conversationsById[conversationId];
    if (graph) return jsonResponse(clone(graph));
    return jsonResponse({ error: { message: 'Conversation not found.' } }, 404);
  }
  if (pathname === '/api/v1/local-ai/operations' && upper === 'POST') {
    return jsonResponse({ result: { data: [] } });
  }
  if (conversationId && (pathname.endsWith('/messages') || pathname.endsWith('/turns')) && upper === 'POST') {
    const graph = state.conversationsById[conversationId] ?? { conversation: { id: conversationId, messages: [] } };
    return jsonResponse(clone(graph));
  }
  if (conversationId && upper === 'PATCH') {
    const graph = state.conversationsById[conversationId] ?? { conversation: { id: conversationId } };
    return jsonResponse(clone(graph));
  }
  if (conversationId && upper === 'DELETE') {
    delete state.conversationsById[conversationId];
    delete state.conversationHistoryById[conversationId];
    return jsonResponse({ ok: true });
  }
  if (pathname === '/api/v1/conversations' && upper === 'POST') {
    const input = bodyText ? JSON.parse(bodyText) as { conversationId?: string } : {};
    const id = input.conversationId ?? crypto.randomUUID();
    const graph = { conversation: { id, title: 'New chat', messages: [], pinned: false, archived: false, tags: [] } };
    state.conversationsById[id] = graph;
    state.conversationHistoryById[id] = { conversation: graph.conversation, messages: [], hasEarlier: false, hasLater: false, leafId: null };
    return jsonResponse(graph);
  }

  const scopeMatch = pathname.match(/^\/api\/v1\/workspace\/scopes\/([^/]+)\/(material|knowledge)$/);
  if (scopeMatch) {
    const scopeId = decodeURIComponent(scopeMatch[1]!);
    if (scopeMatch[2] === 'material' && upper === 'GET') {
      return jsonResponse(clone(state.scopeMaterial[scopeId] ?? { name: '', instruction: '', sources: [] }));
    }
    if (scopeMatch[2] === 'knowledge' && upper === 'POST') {
      return jsonResponse({ skipped: [] });
    }
  }

  if (pathname === '/api/v1/workspace/nodes' && upper === 'GET') {
    return jsonResponse({ nodes: clone(state.nodes) });
  }
  if (pathname === '/api/v1/workspace/nodes' && upper === 'POST') {
    const node = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : {};
    const stored = { ...node, id: typeof node.id === 'string' ? node.id : crypto.randomUUID() };
    state.nodes.push(stored);
    state.routes['GET /api/v1/workspace/nodes'] = { nodes: state.nodes };
    return jsonResponse({ node: stored });
  }
  if (pathname.startsWith('/api/v1/workspace/nodes/') && (upper === 'PATCH' || upper === 'DELETE')) {
    const id = decodeURIComponent(pathname.slice('/api/v1/workspace/nodes/'.length));
    if (upper === 'DELETE') state.nodes = state.nodes.filter((node) => !(node && typeof node === 'object' && 'id' in node && (node as { id: string }).id === id));
    else if (bodyText) {
      const patch = JSON.parse(bodyText) as Record<string, unknown>;
      state.nodes = state.nodes.map((node) => (node && typeof node === 'object' && 'id' in node && (node as { id: string }).id === id ? { ...node, ...patch } : node));
    }
    state.routes['GET /api/v1/workspace/nodes'] = { nodes: state.nodes };
    return jsonResponse({ ok: true });
  }

  if (pathname === '/api/v1/search' && upper === 'POST') return jsonResponse({ results: [] });
  if (pathname === '/api/v1/runs' && upper === 'POST') {
    const runId = crypto.randomUUID();
    return jsonResponse({ runId, events: `/api/v1/runs/${runId}/events`, cancel: `/api/v1/runs/${runId}` }, 202);
  }
  if (pathname.startsWith('/api/v1/runs/') && pathname.endsWith('/events') && upper === 'GET') {
    return new Response('event: done\ndata: {}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  if (pathname === '/api/v1/workbench/workspace' && upper === 'POST') {
    return jsonResponse({ error: { message: 'Code workbench is not available in the static demo.' } }, 503);
  }

  if (upper === 'GET') return jsonResponse(emptyFor(pathname));
  // Mutations succeed as no-ops so the shell stays calm without a real service.
  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText) as unknown;
      if (parsed && typeof parsed === 'object') return jsonResponse(parsed);
    } catch { /* ignore */ }
  }
  return jsonResponse({ ok: true });
}

/** In-browser stand-in for the Bun service used only by the static Pages build. */
export function createStaticDemoClient(): ServiceClient {
  return {
    get base() { return STATIC_BASE; },
    async token() { return 'static-demo'; },
    async request(path, init = {}) {
      const method = init.method ?? 'GET';
      const bodyText = typeof init.body === 'string' ? init.body : init.body instanceof FormData ? undefined : init.body != null ? String(init.body) : undefined;
      return handle(method, path, bodyText);
    },
    async json<T>(path, init) {
      const response = await this.request(path, init);
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const detail = body && typeof body === 'object' && 'error' in body ? (body as { error: unknown }).error : null;
        const message = typeof detail === 'string'
          ? detail
          : detail && typeof detail === 'object' && detail && 'message' in detail && typeof (detail as { message: unknown }).message === 'string'
            ? (detail as { message: string }).message
            : `Service request failed (${response.status}).`;
        throw new Error(message);
      }
      if (response.status === 204) return undefined as T;
      return response.json() as Promise<T>;
    },
  };
}

