import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtractionArtifact } from '@office/contracts/document';
import type { EmbeddingIndexIdentity } from '@office/contracts/knowledge';
import { createSqliteKnowledgeStore } from '../../../packages/knowledge/src/knowledge-store.adapter';
import { chunkText, CHUNKER_VERSION, cosineSimilarity, isCompatibleIndex, rankByVector, type AccessPolicy } from '../../../packages/knowledge/src/knowledge.domain.public';
import { createDeterministicEmbeddingProvider, createKnowledgeService, probeSqliteVec } from '../../../packages/knowledge/src/knowledge.service.public';

const identity: EmbeddingIndexIdentity = { model: 'deterministic-hash', dimensions: 64, metric: 'cosine', chunkerVersion: CHUNKER_VERSION };
const artifact = (text: string): ExtractionArtifact => ({ extractor: 'fixture', extractorVersion: '1', extractionVersion: 'anchor-v1', text, pageCount: null, warnings: [], contentHash: 'fixture-hash', createdAt: new Date(0).toISOString() });

test('chunking produces bounded chunks with UTF-8 byte-range anchors', () => {
  const text = 'a'.repeat(3000);
  const chunks = chunkText('v1', 'c1', 'anchor-v1', text, { size: 1000, overlap: 0 });
  expect(chunks).toHaveLength(3);
  expect(chunks[0]?.anchor).toMatchObject({ kind: 'text-range', startByte: 0, endByte: 1000 });
  expect(chunks[2]?.anchor).toMatchObject({ startByte: 2000, endByte: 3000 });
  expect(chunks.every((chunk) => chunk.text.length <= 1000)).toBe(true);
});

test('embedding generations are only compatible when model, dimensions, metric and chunker agree', () => {
  expect(isCompatibleIndex(identity, { ...identity })).toBe(true);
  expect(isCompatibleIndex(identity, { ...identity, dimensions: 128 })).toBe(false);
  expect(isCompatibleIndex(identity, { ...identity, metric: 'l2' })).toBe(false);
  expect(isCompatibleIndex(identity, { ...identity, model: 'other' })).toBe(false);
  expect(isCompatibleIndex(identity, { ...identity, chunkerVersion: 'char-window-v2' })).toBe(false);
});

test('an incompatible index contributes no ranked results', () => {
  const chunk = { id: 'k1', sourceVersionId: 'v1', collectionId: 'c1', ordinal: 0, text: 'x', anchor: { sourceVersionId: 'v1', extractionVersion: 'anchor-v1', kind: 'text-range' as const, startByte: 0, endByte: 1 } };
  const ranked = rankByVector(identity, [1, 0, 0], [{ chunk, embedding: [1, 0, 0], identity: { ...identity, dimensions: 3, model: 'other' } }], 5);
  expect(ranked).toHaveLength(0);
});

test('the index status reports the chunk count, so an index without content is visible', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-knowledge-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    const service = createKnowledgeService(store, createDeterministicEmbeddingProvider());
    service.createCollection('c1', 'Research');
    // An identity without chunks reads as indexed, which would hide the fact
    // that a search over it can never return anything.
    expect(service.indexStatus('c1')).toMatchObject({ current: null, chunks: 0 });
    await service.indexSource({ collectionId: 'c1', sourceVersionId: 'v1', artifact: artifact('the quick brown fox') });
    expect(service.indexStatus('c1')).toMatchObject({ current: { model: 'deterministic-hash' }, chunks: 1 });
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('a source is reported as indexed only under the generation that indexed it', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-knowledge-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    const service = createKnowledgeService(store, createDeterministicEmbeddingProvider());
    service.createCollection('c1', 'Research');
    expect(service.isSourceIndexed('c1', 'v1')).toBe(false);
    await service.indexSource({ collectionId: 'c1', sourceVersionId: 'v1', artifact: artifact('the quick brown fox') });
    // The source is indexed, so a restart does not re-embed it. A different
    // generation makes it pending again, because that index cannot be read.
    expect(service.isSourceIndexed('c1', 'v1')).toBe(true);
    const other = createKnowledgeService(store, createDeterministicEmbeddingProvider(128, 'other-model'));
    expect(other.isSourceIndexed('c1', 'v1')).toBe(false);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('cosine similarity is zero for a zero vector', () => {
  expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
});

test('indexing then retrieving filters by access policy', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-knowledge-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    const service = createKnowledgeService(store, createDeterministicEmbeddingProvider());
    service.createCollection('c1', 'Research');
    await service.indexSource({ collectionId: 'c1', sourceVersionId: 'v1', artifact: artifact('the quick brown fox jumps over the lazy dog') });
    const allow: AccessPolicy = { canRead: () => true };
    const deny: AccessPolicy = { canRead: () => false };
    const query = { mode: 'full-text' as const, text: 'fox', limit: 5 };
    expect((await service.retrieve({ collectionIds: ['c1'], query, policy: allow })).length).toBeGreaterThan(0);
    expect(await service.retrieve({ collectionIds: ['c1'], query, policy: deny })).toHaveLength(0);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('vector retrieval returns a chunk whose anchor resolves against the source', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-knowledge-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    const embedder = createDeterministicEmbeddingProvider();
    const service = createKnowledgeService(store, embedder);
    service.createCollection('c1', 'Research');
    await service.indexSource({ collectionId: 'c1', sourceVersionId: 'v1', artifact: artifact('draft recovery keeps unsaved edits') });
    const [queryVector] = await embedder.embed(['recovery']);
    const results = await service.retrieve({ collectionIds: ['c1'], query: { mode: 'vector', text: 'recovery', embedding: queryVector, index: identity, limit: 3 }, policy: { canRead: () => true } });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.anchor.kind).toBe('text-range');
    expect(results[0]?.sourceVersionId).toBe('v1');
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('re-indexing a source version replaces its chunks instead of duplicating', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-knowledge-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    const service = createKnowledgeService(store, createDeterministicEmbeddingProvider());
    service.createCollection('c1', 'Research');
    await service.indexSource({ collectionId: 'c1', sourceVersionId: 'v1', artifact: artifact('alpha beta gamma') });
    await service.indexSource({ collectionId: 'c1', sourceVersionId: 'v1', artifact: artifact('alpha beta gamma') });
    expect(store.chunksOf('v1')).toHaveLength(1);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('removing a revoked source clears its chunks so it cannot be surfaced', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-knowledge-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    const service = createKnowledgeService(store, createDeterministicEmbeddingProvider());
    service.createCollection('c1', 'Research');
    await service.indexSource({ collectionId: 'c1', sourceVersionId: 'v1', artifact: artifact('secret content') });
    service.removeSource('v1');
    expect(store.chunksOf('v1')).toHaveLength(0);
    expect(store.fullTextSearch(['c1'], 'secret', 5)).toHaveLength(0);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('storing a vector of the wrong dimensions is rejected', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-knowledge-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    store.ensureCollection({ id: 'c1', name: 'Research', createdAt: new Date(0).toISOString() });
    const chunks = chunkText('v1', 'c1', 'anchor-v1', 'hello');
    const index = { id: 'i1', collectionId: 'c1', ...identity, createdAt: new Date(0).toISOString() };
    expect(() => store.commitSourceGeneration(index, 'v1', chunks, [{ chunkId: chunks[0]!.id, embedding: [1, 2, 3] }])).toThrow('Embedding dimensions do not match the index.');
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('indexing reports progress checkpoints and completes under one generation', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-knowledge-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    const service = createKnowledgeService(store, createDeterministicEmbeddingProvider());
    service.createCollection('c1', 'Research');
    const checkpoints: string[] = [];
    const text = 'alpha beta gamma delta epsilon '.repeat(200);
    const result = await service.indexSourceVersion({ collectionId: 'c1', sourceVersionId: 'v1', artifact: artifact(text), batchSize: 2, report: (_progress, checkpoint) => { if (checkpoint) checkpoints.push(checkpoint); } });
    expect(result.chunks).toBeGreaterThan(2);
    expect(checkpoints.at(-1)).toBe('v1:done');
    expect(store.indexIdentity('c1')?.model).toBe('deterministic-hash');
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('a cancelled indexing run does not commit an index identity or vectors', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-knowledge-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    const service = createKnowledgeService(store, createDeterministicEmbeddingProvider());
    service.createCollection('c1', 'Research');
    const text = 'alpha beta gamma delta '.repeat(400);
    await expect(service.indexSourceVersion({ collectionId: 'c1', sourceVersionId: 'v1', artifact: artifact(text), batchSize: 1, isCancelled: () => true })).rejects.toThrow('cancelled');
    expect(store.indexIdentity('c1')).toBeNull();
    expect(store.vectorEntries(['c1'], identity)).toHaveLength(0);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('a failed source replacement preserves its previous chunks, vectors, and index identity', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-knowledge-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    const good = createKnowledgeService(store, createDeterministicEmbeddingProvider());
    good.createCollection('c1', 'Research');
    await good.indexSource({ collectionId: 'c1', sourceVersionId: 'v1', artifact: artifact('original fox content') });
    const oldChunks = store.chunksOf('v1');
    const oldIndex = store.indexIdentity('c1');
    const failing = createKnowledgeService(store, { model: 'broken', dimensions: 64, embed: async () => { throw new Error('embedding failed'); } });
    await expect(failing.indexSource({ collectionId: 'c1', sourceVersionId: 'v1', artifact: artifact('replacement wolf content') })).rejects.toThrow('embedding failed');
    expect(store.chunksOf('v1')).toEqual(oldChunks);
    expect(store.indexIdentity('c1')).toEqual(oldIndex);
    expect(store.vectorEntries(['c1'], identity)).toHaveLength(oldChunks.length);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('collection rebuild atomically replaces the full collection, including an empty source list', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-knowledge-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    const service = createKnowledgeService(store, createDeterministicEmbeddingProvider());
    service.createCollection('c1', 'Research');
    await service.indexSource({ collectionId: 'c1', sourceVersionId: 'old', artifact: artifact('obsolete fox') });
    const result = await service.rebuildCollection({ collectionId: 'c1', sources: [{ sourceVersionId: 'new', artifact: artifact('current wolf') }] });
    expect(result.chunks).toBe(1);
    expect(store.chunksOf('old')).toHaveLength(0);
    expect(store.chunksOf('new')).toHaveLength(1);
    expect(store.fullTextSearch(['c1'], 'obsolete', 5)).toHaveLength(0);
    await service.rebuildCollection({ collectionId: 'c1', sources: [] });
    expect(store.chunksOf('new')).toHaveLength(0);
    expect(store.vectorEntries(['c1'], identity)).toHaveLength(0);
    expect(store.indexIdentity('c1')).toEqual(identity);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});
test('the vector probe reports honestly when no extension is configured', () => {
  const result = probeSqliteVec(null);
  expect(result.available).toBe(false);
  expect(result.detail).toContain('sqlite-vec');
});

test('a hybrid query merges vector and lexical results without duplicates', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-knowledge-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    const embedder = createDeterministicEmbeddingProvider();
    const service = createKnowledgeService(store, embedder);
    service.createCollection('c1', 'Research');
    await service.indexSourceVersion({ collectionId: 'c1', sourceVersionId: 'v1', artifact: artifact('draft recovery keeps unsaved edits safe') });
    const [queryVector] = await embedder.embed(['draft recovery']);
    const results = await service.retrieve({ collectionIds: ['c1'], query: { mode: 'hybrid', text: 'recovery', embedding: queryVector, index: identity, limit: 5 }, policy: { canRead: () => true } });
    const ids = results.map((result) => result.chunkId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(results.length).toBeGreaterThan(0);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});
