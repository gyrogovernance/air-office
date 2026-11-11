import { expect, test } from 'bun:test';
import { decideAutoIndex, estimateIndexBytes } from '../../../packages/knowledge/src/auto-index.policy';

test('a document that entered a collection is indexed without being asked for', () => {
  expect(decideAutoIndex({ collectionId: 'pack', hasText: true, collectionKnown: true, embeddingAvailable: true })).toEqual({ index: true, reason: 'collection-member' });
});

test('a document outside a collection, or one whose text is missing, is not indexed', () => {
  expect(decideAutoIndex({ collectionId: null, hasText: true, collectionKnown: true, embeddingAvailable: true }).reason).toBe('no-collection');
  expect(decideAutoIndex({ collectionId: 'pack', hasText: true, collectionKnown: false, embeddingAvailable: true }).reason).toBe('no-collection');
  expect(decideAutoIndex({ collectionId: 'pack', hasText: false, collectionKnown: true, embeddingAvailable: true }).reason).toBe('no-text');
});

test('a document stays unindexed while no embedding model is selected', () => {
  const decision = decideAutoIndex({ collectionId: 'pack', hasText: true, collectionKnown: true, embeddingAvailable: false });
  expect(decision.index).toBe(false);
  expect(decision.reason).toBe('index-unavailable');
});

test('the index cost is the stored chunk text plus one float32 vector per chunk', () => {
  // 600 chunks of 1000 characters each, with 1024 dimensions, costs about
  // 3.1 MB: 600 KB of text and 2.4 MB of vectors.
  expect(estimateIndexBytes({ chunkTextBytes: 600_000, chunks: 600, dimensions: 1024 })).toBe(600_000 + 600 * 1024 * 4);
  expect(estimateIndexBytes({ chunkTextBytes: -1, chunks: -1, dimensions: -1 })).toBe(0);
});
