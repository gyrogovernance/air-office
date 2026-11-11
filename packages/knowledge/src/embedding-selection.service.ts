import type { EmbeddingIndexIdentity } from '@office/contracts/knowledge';
import type { EmbeddingProvider, EmbeddingSelection, KnowledgeStore } from './knowledge-store.port';
import { CHUNKER_VERSION } from './knowledge.domain.public';
import { createSerialQueue } from './embedding-queue.policy';
import { createDeterministicEmbeddingProvider, createKnowledgeService } from './knowledge.service.public';

export function validateEmbeddingSelection(value: unknown): EmbeddingSelection {
  const input = value as Partial<EmbeddingSelection> | null;
  if (!input || typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200 || typeof input.revision !== 'string' || !input.revision.trim() || input.revision.length > 300 || !Number.isSafeInteger(input.dimensions) || input.dimensions! < 1 || input.dimensions! > 65536 || input.mode !== 'runtime' && input.mode !== 'demo') throw new Error('Choose an embedding model, its exact model or recipe revision, and valid vector dimensions.');
  if (input.rerankModel !== undefined && (typeof input.rerankModel !== 'string' || input.rerankModel.length > 200)) throw new Error('Choose a valid reranking model.');
  for (const limit of [input.inputTokenLimit, input.rerankTokenLimit]) if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 64 || limit > 1_000_000)) throw new Error('Model input limits must be whole token counts between 64 and 1000000.');
  return { ...(input.rerankModel?.trim() ? { rerankModel: input.rerankModel.trim() } : {}), ...(input.inputTokenLimit ? { inputTokenLimit: input.inputTokenLimit } : {}), ...(input.rerankTokenLimit ? { rerankTokenLimit: input.rerankTokenLimit } : {}), model: input.model.trim(), revision: input.revision.trim(), dimensions: input.dimensions!, mode: input.mode };
}

/** Each service and request retains one immutable selection; superseded work cannot commit. */
export function createEmbeddingSelectionService(store: KnowledgeStore, options: {
  initial?: EmbeddingSelection;
  demo?: boolean;
  runtimeEmbed?: (selection: Readonly<EmbeddingSelection>, texts: readonly string[], signal?: AbortSignal) => Promise<number[][]>;
}) {
  let generation = 0;
  // One embedding call at a time. The managed runtime serves a single request
  // at a time, so two jobs that embed together would make one of them fail.
  const embeddingQueue = createSerialQueue();
  const persisted = store.embeddingSelection();
  let selection: EmbeddingSelection | null = persisted ? validateEmbeddingSelection(persisted) : options.initial ? validateEmbeddingSelection(options.initial) : options.demo ? { model: 'deterministic-hash', revision: 'demo-hash-v1', dimensions: 64, mode: 'demo' } : null;
  if (!persisted && selection) store.saveEmbeddingSelection(selection);
  const snapshot = () => {
    const captured = selection ? Object.freeze({ ...selection }) : null;
    const capturedGeneration = generation;
    const assertCurrent = () => { if (capturedGeneration !== generation) throw new Error('The embedding selection changed during this operation. Retry with the current selection.'); };
    const provider: EmbeddingProvider = {
      model: captured?.model ?? '', revision: captured?.revision, dimensions: captured?.dimensions ?? 0,
      maxInputBytes: Math.max(32, (captured?.inputTokenLimit ?? 512) - 32),
      assertCurrent,
      embed: async (texts, signal) => {
        signal?.throwIfAborted();
        assertCurrent();
        if (!captured) throw new Error('Select a real embedding model, revision and dimensions before indexing or vector search.');
        let vectors: number[][];
        if (captured.mode === 'demo') {
          if (!options.demo) throw new Error('Deterministic embeddings require explicit demo or test mode. Select a real runtime model.');
          vectors = await createDeterministicEmbeddingProvider(captured.dimensions, captured.model).embed(texts);
        } else {
          if (!options.runtimeEmbed) throw new Error('The managed embedding runtime is unavailable.');
          vectors = await embeddingQueue.run(() => { signal?.throwIfAborted(); return options.runtimeEmbed!(captured, texts, signal); });
        }
        assertCurrent();
        signal?.throwIfAborted();
        if (vectors.length !== texts.length || vectors.some((vector) => !Array.isArray(vector) || vector.length !== captured.dimensions || vector.some((value) => !Number.isFinite(value)))) throw new Error('The selected embedding model returned invalid vectors or incompatible dimensions.');
        return vectors;
      }
    };
    const identity: EmbeddingIndexIdentity = { model: provider.model, revision: provider.revision, dimensions: provider.dimensions, metric: 'cosine', chunkerVersion: CHUNKER_VERSION };
    return { knowledge: createKnowledgeService(store, provider), provider, identity };
  };
  let current = snapshot();
  return {
    snapshot: () => current,
    selection: () => selection ? { ...selection } : null,
    select: (value: unknown) => {
      const next = validateEmbeddingSelection(value);
      if (next.mode === 'demo' && !options.demo) throw new Error('Deterministic embeddings require explicit demo or test mode.');
      if (next.mode === 'runtime' && !options.runtimeEmbed) throw new Error('The managed embedding runtime is unavailable.');
      if (JSON.stringify(next) === JSON.stringify(selection)) return current;
      store.saveEmbeddingSelection(next);
      selection = next;
      generation += 1;
      current = snapshot();
      return current;
    }
  };
}
