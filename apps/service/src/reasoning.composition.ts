import type { ConversationStore } from '@office/chat/service';
import type { KnowledgeService } from '@office/knowledge/service';
import type { JobsService } from '@office/jobs/service';
import type { MemoryService, ReasoningPorts } from '@office/memory/service';
import { createVaultEpisodicStore, createReasoningService } from '@office/memory/service';
import type { EpisodicRecord } from '@office/memory/domain';

export const REASONING_COLLECTION_ID = 'air-reasoning-memories';
const collectionId = REASONING_COLLECTION_ID;
const sourceId = (record: Pick<EpisodicRecord, 'record_id'>) => `reasoning:${record.record_id}`;

export function createReasoningComposition(input: {
  privateRoot: string;
  vaultRoot: string;
  conversations: ConversationStore;
  memory: MemoryService;
  knowledge(): KnowledgeService;
  embedding(text: string, signal?: AbortSignal): Promise<readonly number[]>;
  /** When false, memory capture still works but vector indexing waits — no failed job spam. */
  embeddingReady?(): boolean;
  inputTokenLimit?(): number;
  rerank?: ReasoningPorts['rerank'];
  jobs: JobsService;
  foregroundBusy: ReasoningPorts['foregroundBusy'];
}) {
  return createReasoningService(createVaultEpisodicStore(input.vaultRoot), {
    enabled: () => input.memory.enabled(),
    messages: (id) => input.conversations.load(id)?.messages.map(message => ({ id: message.id, parentId: message.parentId, role: message.role, content: message.content, complete: message.complete, createdAt: message.createdAt, failed: !!message.error || message.statusHistory.at(-1)?.label === 'cancelled' })) ?? [],
    foregroundBusy: input.foregroundBusy,
    async index(record, text, signal) {
      const knowledge = input.knowledge();
      if (!knowledge.collections().some(collection => collection.id === collectionId)) knowledge.createCollection(collectionId, 'Reasoning memories', 'Saved user, assistant, user exchanges.');
      await knowledge.indexSourceVersion({ collectionId, sourceVersionId: sourceId(record), batchSize: 1, representation: 'exchange', signal, isCancelled: () => signal.aborted || !input.memory.enabled() || input.foregroundBusy(), artifact: { extractor: 'exchange-capture', extractorVersion: '2', extractionVersion: 'exchange', text, pageCount: null, warnings: [], contentHash: '', createdAt: record.created_at } });
    },
    removeIndex: (record) => input.knowledge().removeSource(sourceId(record)),
    indexGeneration: () => JSON.stringify({ index: input.knowledge().indexStatus(collectionId).configured, inputTokenLimit: input.inputTokenLimit?.() ?? 512, representation: 'exchange-v2' }),
    rerank: input.rerank,
    async retrieve(query, records, signal) {
      if (!records.length) return [];
      const bySource = new Map(records.map(record => [sourceId(record), record.record_id]));
      const knowledge = input.knowledge();
      const embedding = await input.embedding(query, signal);
      const hits = await knowledge.retrieve({ collectionIds: [collectionId], query: { mode: 'hybrid', text: query, embedding, index: knowledge.indexStatus(collectionId).configured, limit: 6, groupBySource: true, sourceVersionIds: [...bySource.keys()] }, policy: { canRead: (_collection, source) => bySource.has(source) } });
      return [...new Set(hits.flatMap(hit => { const id = bySource.get(hit.sourceVersionId); return id ? [id] : []; }))];
    },
    async job(id, work) {
      // Without an embedding model, keep the exchange pending and do not mint job rows.
      if (input.embeddingReady && !input.embeddingReady()) {
        throw Object.assign(new Error('Memory search indexing waits until an embedding model is chosen in Settings → Knowledge.'), { code: 'deferred' });
      }
      const existing = input.jobs.list().find((job) => job.kind === 'reasoning-memory' && job.idempotencyKey === id);
      if (existing?.state === 'succeeded') return undefined as never;
      // A failed attempt for this generation retries under a distinct key after the drain backoff.
      const key = existing && ['failed', 'cancelled'].includes(existing.state) ? `${id}:retry:${Date.now()}` : id;
      const { job } = input.jobs.start('reasoning-memory', key);
      const controller = new AbortController();
      const timer = setInterval(() => { if (input.jobs.get(job.id)?.state === 'cancelled') controller.abort(); }, 200);
      try { return await input.jobs.run(job.id, () => work(controller.signal)); }
      finally { clearInterval(timer); }
    },
  });
}
