import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtractionArtifact } from '@office/contracts/document';
import { createEmbeddingSelectionService, createSqliteKnowledgeStore } from '../../../packages/knowledge/src/knowledge.service.public';

const artifact: ExtractionArtifact = { extractor: 'test', extractorVersion: '1', extractionVersion: '1', text: 'embedding selection recovery', pageCount: null, warnings: [], contentHash: 'test', createdAt: '' };
const selection = { model: 'embed:model', revision: 'recipe-v1', dimensions: 2, mode: 'runtime' as const };
const scratch = () => mkdtempSync(join(tmpdir(), 'air-embedding-selection-'));

test('selection survives reopening, overrides bootstrap defaults and sends the selected model', async () => {
  const dir = scratch();
  let store = createSqliteKnowledgeStore(join(dir, 'knowledge.sqlite'));
  try {
    const calls: string[] = [];
    const runtimeEmbed = async (value: { model: string; revision: string }, texts: readonly string[]) => { calls.push(`${value.model}@${value.revision}`); return texts.map(() => [1, 0]); };
    let controller = createEmbeddingSelectionService(store, { runtimeEmbed });
    expect(controller.selection()).toBeNull();
    await expect(controller.snapshot().provider.embed(['test'])).rejects.toThrow('Select a real');
    controller.select(selection);
    store.close();
    store = createSqliteKnowledgeStore(join(dir, 'knowledge.sqlite'));
    controller = createEmbeddingSelectionService(store, { runtimeEmbed, initial: { ...selection, model: 'bootstrap' } });
    expect(controller.selection()).toEqual(selection);
    await controller.snapshot().provider.embed(['test']);
    expect(calls).toEqual(['embed:model@recipe-v1']);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('changing selection rejects in-flight batches before commit and keeps prior data intact', async () => {
  const dir = scratch();
  const store = createSqliteKnowledgeStore(join(dir, 'knowledge.sqlite'));
  try {
    let finish: (() => void) | undefined;
    let defer = false;
    const controller = createEmbeddingSelectionService(store, { initial: selection, runtimeEmbed: async (_selection, texts) => {
      if (defer) await new Promise<void>((resolve) => { finish = resolve; });
      return texts.map(() => [1, 0]);
    } });
    const prior = controller.snapshot();
    prior.knowledge.createCollection('c', 'Collection');
    await prior.knowledge.indexSource({ collectionId: 'c', sourceVersionId: 'old', artifact });
    defer = true;
    const inFlight = prior.knowledge.rebuildCollection({ collectionId: 'c', sources: [{ sourceVersionId: 'new', artifact }] });
    controller.select({ ...selection, revision: 'recipe-v2' });
    finish!();
    await expect(inFlight).rejects.toThrow('selection changed');
    expect(store.chunksOf('old')).toHaveLength(1);
    expect(store.chunksOf('new')).toHaveLength(0);
    expect(controller.snapshot().knowledge.indexStatus('c').rebuildRequired).toBe(true);
    expect(store.vectorEntries(['c'], controller.snapshot().identity)).toHaveLength(0);
    defer = false;
    await expect(controller.snapshot().knowledge.indexSource({ collectionId: 'c', sourceVersionId: 'new', artifact })).rejects.toThrow('Rebuild');
    await controller.snapshot().knowledge.rebuildCollection({ collectionId: 'c', sources: [{ sourceVersionId: 'new', artifact }] });
    expect(controller.snapshot().knowledge.indexStatus('c').rebuildRequired).toBe(false);
    expect(store.vectorEntries(['c'], controller.snapshot().identity)).toHaveLength(1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('demo embeddings require explicit mode, and runtime vectors must be finite and dimensioned', async () => {
  const dir = scratch();
  const store = createSqliteKnowledgeStore(join(dir, 'knowledge.sqlite'));
  try {
    const controller = createEmbeddingSelectionService(store, { runtimeEmbed: async () => [[NaN, 0]] });
    expect(() => controller.select({ ...selection, mode: 'demo' })).toThrow('explicit demo');
    expect(() => controller.select({ ...selection, revision: '' })).toThrow('revision');
    controller.select(selection);
    await expect(controller.snapshot().provider.embed(['test'])).rejects.toThrow('invalid vectors');
    const demo = createEmbeddingSelectionService(store, { demo: true });
    demo.select({ ...selection, model: 'deterministic-hash', mode: 'demo' });
    expect((await demo.snapshot().provider.embed(['test']))[0]).toHaveLength(2);
    const reopened = createEmbeddingSelectionService(store, {});
    await expect(reopened.snapshot().provider.embed(['test'])).rejects.toThrow('explicit demo');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('legacy index and vectors migrate without losing lexical content or pretending a revision', () => {
  const dir = scratch();
  const path = join(dir, 'knowledge.sqlite');
  const db = new Database(path);
  db.exec(`CREATE TABLE knowledge_indexes (collection_id TEXT PRIMARY KEY, index_id TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, metric TEXT NOT NULL, chunker_version TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO knowledge_indexes VALUES ('c', 'legacy', 'embed:model', 2, 'cosine', 'char-window-v1', '');
    CREATE TABLE knowledge_embeddings (chunk_id TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, metric TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (chunk_id, model, dimensions, metric));`);
  db.close();
  const store = createSqliteKnowledgeStore(path);
  try {
    const controller = createEmbeddingSelectionService(store, { initial: selection, runtimeEmbed: async () => [[1, 0]] });
    expect(store.indexIdentity('c')?.revision).toBeUndefined();
    expect(controller.snapshot().knowledge.indexStatus('c').rebuildRequired).toBe(true);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
