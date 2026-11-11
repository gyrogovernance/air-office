import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteKnowledgeStore } from '../../../packages/knowledge/src/knowledge-store.adapter';
import { createEmbeddingSelectionService } from '../../../packages/knowledge/src/embedding-selection.service';

/**
 * The managed runtime serves one embedding request at a time. Two indexing
 * jobs that reach it together used to make one of them fail with an opaque
 * runtime error, even though each request was valid on its own.
 */
test('two collections that embed at the same time both succeed', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-embed-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    let active = 0;
    let overlap = false;
    const selection = createEmbeddingSelectionService(store, {
      initial: { model: 'local-embedding', revision: 'rev-1', dimensions: 3, mode: 'runtime' },
      runtimeEmbed: async (_selection, texts) => {
        active += 1;
        if (active > 1) overlap = true;
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return texts.map(() => [1, 0, 0]);
      }
    });
    const snapshot = selection.snapshot();
    const artifact = (text: string) => ({ extractor: 'fixture', extractorVersion: '1', extractionVersion: 'anchor-v1', text, pageCount: null, warnings: [], contentHash: 'h', createdAt: new Date(0).toISOString() });
    const results = await Promise.all([
      snapshot.knowledge.indexSourceVersion({ collectionId: 'c1', sourceVersionId: 'v1', artifact: artifact('first collection text') }),
      snapshot.knowledge.indexSourceVersion({ collectionId: 'c2', sourceVersionId: 'v2', artifact: artifact('second collection text') })
    ]);
    expect(results.map((result) => result.chunks)).toEqual([1, 1]);
    // The runtime is single-flight, so the calls must not have overlapped.
    expect(overlap).toBe(false);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('a failed embedding does not block the work queued behind it', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-embed-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    let calls = 0;
    const selection = createEmbeddingSelectionService(store, {
      initial: { model: 'local-embedding', revision: 'rev-1', dimensions: 3, mode: 'runtime' },
      runtimeEmbed: async (_selection, texts) => {
        calls += 1;
        if (calls === 1) throw new Error('The local model operation could not be completed.');
        return texts.map(() => [1, 0, 0]);
      }
    });
    const snapshot = selection.snapshot();
    const artifact = (text: string) => ({ extractor: 'fixture', extractorVersion: '1', extractionVersion: 'anchor-v1', text, pageCount: null, warnings: [], contentHash: 'h', createdAt: new Date(0).toISOString() });
    const failing = snapshot.knowledge.indexSourceVersion({ collectionId: 'c1', sourceVersionId: 'v1', artifact: artifact('first collection text') });
    await expect(failing).rejects.toThrow('could not be completed');
    const following = await snapshot.knowledge.indexSourceVersion({ collectionId: 'c2', sourceVersionId: 'v2', artifact: artifact('second collection text') });
    expect(following.chunks).toBe(1);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});
