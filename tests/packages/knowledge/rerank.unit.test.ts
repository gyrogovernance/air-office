import { expect, test } from 'bun:test';
import type { RetrievalResult } from '@office/contracts/knowledge';
import { applyReranking } from '../../../packages/knowledge/src/rerank.policy';

test('reranking preserves each source object and anchor while reordering by relevance', () => {
  const results: RetrievalResult[] = ['first', 'second'].map((id) => ({ chunkId: id, sourceVersionId: `version-${id}`, collectionId: 'research', text: id, score: 0.5, resolved: true, anchor: { sourceVersionId: `version-${id}`, extractionVersion: 'v1', kind: 'text-range', startByte: 0, endByte: id.length } }));
  const ordered = applyReranking(results, [{ index: 0, relevance_score: 0.1 }, { index: 1, relevance_score: 0.9 }]);
  expect(ordered.map((item) => item.chunkId)).toEqual(['second', 'first']);
  expect(ordered[0]).toBe(results[1]);
  expect(ordered[1]?.anchor).toBe(results[0]?.anchor);
  for (const invalid of [[{ index: 0, relevance_score: 1 }], [{ index: 0, relevance_score: 1 }, { index: 0, relevance_score: 0 }], [{ index: 2, relevance_score: 1 }, { index: 1, relevance_score: 0 }], [{ index: 0, relevance_score: NaN }, { index: 1, relevance_score: 0 }]]) expect(() => applyReranking(results, invalid)).toThrow();
});
