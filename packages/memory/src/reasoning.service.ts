import type { EpisodicRecord, ReasoningMessage, ExchangeReference } from './episodic-memory.policy';
import { exchangeMessagesSchema, episodicProjection } from './episodic-memory.policy';
import { reasoningFingerprint, type VaultEpisodicStore } from './episodic-vault.adapter';
import { exchangePack } from './exchange-network.policy';

export interface MemoryRanking { ids: string[]; method: 'embedding' | 'reranker'; reason?: 'not-configured' | 'unavailable' | 'input-limit' | 'failed'; }

export interface ReasoningPorts {
  enabled(): boolean;
  messages(conversationId: string): ReasoningMessage[];
  foregroundBusy(): boolean;
  index(record: EpisodicRecord, text: string, signal: AbortSignal): Promise<void>;
  indexGeneration?(): string;
  removeIndex(record: EpisodicRecord): void;
  retrieve(query: string, records: readonly Pick<EpisodicRecord, 'record_id'>[], signal?: AbortSignal): Promise<string[]>;
  rerank?(query: string, records: readonly EpisodicRecord[], signal?: AbortSignal): Promise<MemoryRanking>;
  job<T>(id: string, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
}

function ancestry(messages: ReasoningMessage[], leafId: string): ReasoningMessage[] {
  const byId = new Map(messages.map(message => [message.id, message]));
  const path: ReasoningMessage[] = [];
  const seen = new Set<string>();
  let message = byId.get(leafId);
  while (message && !seen.has(message.id)) {
    seen.add(message.id); path.unshift(message);
    message = message.parentId ? byId.get(message.parentId) : undefined;
  }
  return path;
}

function preview(content: string) {
  if (content.length <= 2000) return { content, truncated: false };
  const omission = '\n[… middle omitted …]\n';
  return { content: content.slice(0, 1000) + omission + content.slice(-(1000 - omission.length)), truncated: true };
}

export interface MemoryScope { conversationId: string; leafId: string }

export function createReasoningService(store: VaultEpisodicStore, ports: ReasoningPorts) {
  let draining = false;
  let stopped = false;
  let retryAt = 0;
  let generation = store.generation();
  let operations = new AbortController();
  const scopeFilter = (scope?: MemoryScope) => {
    const ids = scope ? new Set(ancestry(ports.messages(scope.conversationId), scope.leafId).map(message => message.id)) : null;
    return (record: EpisodicRecord) => !scope || record.conversation_id !== scope.conversationId || record.sources.every(source => ids?.has(source.message_id));
  };
  const visible = (scope?: MemoryScope): EpisodicRecord[] => store.list().filter(scopeFilter(scope));
  const references = (scope?: MemoryScope): ExchangeReference[] => {
    const ids = scope ? new Set(ancestry(ports.messages(scope.conversationId), scope.leafId).map(message => message.id)) : null;
    return store.catalog().filter(record => !scope || record.conversation_id !== scope.conversationId || record.message_ids.every(id => ids?.has(id)));
  };
  const synchronizeGeneration = () => {
    const current = ports.indexGeneration?.();
    if (current !== undefined && current !== generation) { store.resetIndexes(); store.setGeneration(current); generation = current; }
  };
  const drain = async () => {
    if (draining || stopped || !ports.enabled() || ports.foregroundBusy() || Date.now() < retryAt) return;
    draining = true;
    try {
      synchronizeGeneration();
      for (const record of store.pending()) {
        if (stopped || !ports.enabled() || ports.foregroundBusy()) break;
        try {
          const operationSignal = operations.signal;
          // Idempotency follows the current index generation so a model change
          // can retry, without minting a new failed job on every drain tick.
          const generation = ports.indexGeneration?.() ?? 'default';
          await ports.job(`index:${record.record_id}:${generation}`, async signal => {
            signal.throwIfAborted();
            await ports.index(record, episodicProjection(record), AbortSignal.any([signal, operationSignal]));
          });
          const latest = store.get(record.record_id);
          if (!ports.enabled() || !latest || latest.state === 'deleted') ports.removeIndex(record);
          else store.updateIndex(record.record_id, true, null);
        } catch (error) {
          const deferred = (error as { code?: unknown } | null)?.code === 'deferred';
          const latest = store.get(record.record_id);
          if (latest?.state === 'ready') store.updateIndex(record.record_id, false, stopped || ports.foregroundBusy() || deferred ? (deferred ? 'Exchange saved. Choose an embedding model in Settings → Knowledge to index memory search.' : null) : 'Exchange saved. Search indexing is pending.');
          retryAt = stopped || ports.foregroundBusy() ? 0 : Date.now() + (deferred ? 60_000 : 30_000);
          break;
        }
      }
    } finally { draining = false; }
  };
  const schedule = (conversationId: string, leafId: string) => {
    if (!ports.enabled()) return;
    const path = ancestry(ports.messages(conversationId), leafId).filter(message => message.role !== 'system');
    const closed = path.at(-1)?.role === 'assistant' ? path.slice(0, -1) : path;
    const window = closed.slice(-3);
    const [opening, answer, continuation] = window;
    if (!opening || !answer || !continuation || window.some(message => !message.complete || message.failed)) return;
    const parsed = exchangeMessagesSchema.safeParse(window.map(message => ({ role: message.role, content: message.content })));
    if (!parsed.success) return;
    const identify = (messages: readonly ReasoningMessage[]) => 'exchange-' + reasoningFingerprint(JSON.stringify([conversationId, messages.map(message => [message.id, message.content])]));
    const id = identify(window);
    const previous = closed.slice(-5, -2);
    if (!store.has(id)) {
      store.save({
        record_id: id, conversation_id: conversationId, branch_id: continuation.id, created_at: new Date().toISOString(),
        messages: parsed.data,
        sources: [
          { message_id: opening.id, occurred_at: opening.createdAt, role: 'user' },
          { message_id: answer.id, occurred_at: answer.createdAt, role: 'assistant' },
          { message_id: continuation.id, occurred_at: continuation.createdAt, role: 'user' },
        ],
        state: 'ready', error: null, indexed: false,
      }, previous.length === 3 ? identify(previous) : null);
    }
  };
  return {
    schedule, drain,
    list: (conversationId: string, leafId: string) => store.list(conversationId).filter(scopeFilter({ conversationId, leafId })),
    listViews(scope?: MemoryScope, offset = 0, limit = 25) {
      const rows = references(scope).filter(record => !scope || record.conversation_id === scope.conversationId).reverse();
      const records = rows.slice(offset, offset + Math.min(50, limit)).flatMap(reference => { const record = store.preview(reference.record_id); return record ? [record] : []; });
      return { records, total: rows.length };
    },
    hasRecord: (recordId: string, scope?: MemoryScope) => references(scope).some(record => record.record_id === recordId),
    dataset: (scope?: MemoryScope) => (scope ? store.list(scope.conversationId).filter(scopeFilter(scope)) : store.list()).map(record => ({ messages: record.messages })),
    *datasetRows(scope?: MemoryScope) {
      for (const reference of references(scope)) {
        if (scope && reference.conversation_id !== scope.conversationId) continue;
        const record = store.get(reference.record_id);
        if (record?.state === 'ready') yield { messages: record.messages };
      }
    },
    async search(query: string, limit = 6, scope?: MemoryScope, signal?: AbortSignal, direction?: string) {
      if (!ports.enabled()) return [];
      synchronizeGeneration();
      const capturedGeneration = generation;
      const operationSignal = signal ? AbortSignal.any([signal, operations.signal]) : operations.signal;
      const records = references(scope).filter(record => record.indexed);
      const ids = query.trim() ? await ports.retrieve(query, records, operationSignal) : records.slice().reverse().map(record => record.record_id);
      const allowed = new Set(records.map(record => record.record_id));
      const candidates = [...new Set(ids)].filter(id => allowed.has(id)).slice(0, 6).flatMap(id => {
        const record = store.get(id); return record?.state === 'ready' && record.indexed ? [record] : [];
      });
      const rawRanking: MemoryRanking = query.trim() && candidates.length && ports.rerank
        ? await ports.rerank(direction?.trim() ? `${direction}\nMemory lookup: ${query}` : query, candidates, operationSignal)
        : { ids: candidates.map(record => record.record_id), method: 'embedding', reason: 'not-configured' };
      const candidateIds = candidates.map(record => record.record_id);
      const ranking: MemoryRanking = rawRanking.method === 'reranker' && rawRanking.ids.length
        ? rawRanking
        : { ids: candidateIds, method: 'embedding', ...(rawRanking.method === 'embedding' && rawRanking.reason ? { reason: rawRanking.reason } : rawRanking.method === 'reranker' ? { reason: 'failed' as const } : {}) };
      const currentGeneration = ports.indexGeneration?.();
      if (!ports.enabled() || operationSignal.aborted || generation !== capturedGeneration || currentGeneration !== undefined && currentGeneration !== capturedGeneration) return [];
      const stillVisible = new Set(references(scope).map(record => record.record_id));
      return ranking.ids.filter(id => allowed.has(id) && stillVisible.has(id)).slice(0, Math.max(0, Math.min(6, limit))).flatMap(id => {
        const record = store.get(id);
        if (!record || record.state !== 'ready' || !record.indexed) return [];
        const messages = record.messages.map((message, messageIndex) => ({ role: message.role, messageIndex, length: message.content.length, ...preview(message.content) }));
        return [{ record_id: id, created_at: record.created_at, messages, truncated: messages.some(message => message.truncated), ranking: { method: ranking.method, ...(ranking.reason ? { reason: ranking.reason } : {}) } }];
      });
    },
    readPack(recordId: string, size: 12 | 24, offset = 0, limit = 12000, scope?: MemoryScope, expectedPackId?: string) {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error('Choose a non-negative offset and a positive page size.');
      if (!ports.enabled()) return null;
      const catalog = references(scope);
      const pack = exchangePack(catalog, recordId, size);
      if (!pack) return null;
      const packId = 'pack-' + reasoningFingerprint(JSON.stringify([size, pack.snapshot_ids]));
      if (offset > 0 && !expectedPackId) throw new Error('Include the returned packId when continuing a memory pack.');
      if (expectedPackId && expectedPackId !== packId) throw new Error('This memory pack changed. Read it again from offset zero.');
      const messages = new Map<string, EpisodicRecord['messages'][number]>();
      for (const id of pack.record_ids) {
        const reference = catalog.find(record => record.record_id === id);
        const record = store.get(id);
        if (!reference || record?.state !== 'ready') continue;
        reference.snapshot_ids.forEach((snapshotId, index) => { const message = record.messages[index]; if (message) messages.set(snapshotId, message); });
      }
      const text = JSON.stringify({ messages: pack.snapshot_ids.map(id => messages.get(id)), record_ids: pack.record_ids });
      const pageLimit = Math.min(12000, Math.max(1, limit));
      return { record_id: recordId, packId, window: size, message_count: pack.message_count, complete: pack.complete, start_position: pack.start_position,
        content: text.slice(offset, offset + pageLimit), nextOffset: offset + pageLimit < text.length ? offset + pageLimit : null };
    },
    read(recordId: string, offset = 0, limit = 12000, scope?: MemoryScope, messageIndex?: 0 | 1 | 2) {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error('Choose a non-negative offset and a positive page size.');
      limit = Math.min(12000, limit);
      if (!ports.enabled()) return null;
      const record = store.get(recordId);
      if (!record || record.state === 'deleted' || !scopeFilter(scope)(record)) return null;
      if (messageIndex !== undefined) {
        const message = record.messages[messageIndex];
        return { record_id: recordId, messageIndex, role: message.role, content: message.content.slice(offset, offset + limit), nextOffset: offset + limit < message.content.length ? offset + limit : null };
      }
      const text = JSON.stringify({ messages: record.messages });
      return { record_id: recordId, content: text.slice(offset, offset + limit), nextOffset: offset + limit < text.length ? offset + limit : null };
    },
    retry(conversationId: string | undefined, recordId: string) {
      const record = store.get(recordId);
      if (!record || conversationId !== undefined && record.conversation_id !== conversationId || record.state === 'deleted') return false;
      store.updateIndex(recordId, false, null); retryAt = 0; void drain(); return true;
    },
    forget(conversationId: string | undefined, recordId: string) {
      const record = store.get(recordId);
      if (!record || conversationId !== undefined && record.conversation_id !== conversationId) return false;
      if (record.state === 'ready') {
        ports.removeIndex(record);
        store.save({ state: 'deleted', record_id: record.record_id, conversation_id: record.conversation_id });
      }
      return true;
    },
    interrupt: () => { stopped = true; operations.abort(); },
    resume: () => { if (operations.signal.aborted) operations = new AbortController(); stopped = false; void drain(); },
    clear: () => { operations.abort(); operations = new AbortController(); for (const record of store.list()) ports.removeIndex(record); store.clear(); },
  };
}
