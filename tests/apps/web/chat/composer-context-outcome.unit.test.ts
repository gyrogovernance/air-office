import { describe, expect, test } from 'bun:test';
import { contextRetrievalNotice, contextRetrievalOutcome } from '../../../../apps/web/src/chat/composer-context.policy';
import type { RetrievalResult } from '@office/contracts/knowledge';

const result = (chunkId: string): RetrievalResult => ({
  chunkId,
  sourceVersionId: `v-${chunkId}`,
  collectionId: 'c1',
  text: 'excerpt',
  score: 1,
  anchor: { sourceVersionId: `v-${chunkId}`, extractionVersion: 'a1', kind: 'text-range', startByte: 0, endByte: 1 },
  resolved: true
});

/**
 * A person who attached a document expects the model to read it. A search
 * that found nothing is not the same as a search that never happened, and it
 * must not be silent, because a message that quietly carries no context is
 * indistinguishable from a model that ignored the document.
 */
describe('attached context retrieval outcome', () => {
  test('an empty selection has nothing to search', () => {
    const outcome = contextRetrievalOutcome({ attached: false, results: [] });
    expect(outcome.kind).toBe('not-attached');
    expect(contextRetrievalNotice(outcome)).toBe('');
  });

  test('a search that answered carries its results', () => {
    const outcome = contextRetrievalOutcome({ attached: true, results: [result('k1')] });
    expect(outcome.kind).toBe('retrieved');
    expect(contextRetrievalNotice(outcome)).toContain('1 knowledge snippet');
  });

  test('a search that answered with nothing says so', () => {
    const outcome = contextRetrievalOutcome({ attached: true, results: [] });
    expect(outcome.kind).toBe('no-match');
    expect(contextRetrievalNotice(outcome)).toContain('no match');
  });
});
