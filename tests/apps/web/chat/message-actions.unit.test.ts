import { describe, expect, test } from 'bun:test';
import { appendMessage, createConversationGraph } from '@office/chat/domain';
import {
  deriveFollowUps,
  normalizeRating,
  planMessageDelete,
  readRatings,
  writeRating
} from '../../../../apps/web/src/chat/message-actions.policy';

function graphFixture() {
  let graph = createConversationGraph('c1');
  const add = (id: string, parentId: string | null, role: 'user' | 'assistant', content: string, createdAt: string) =>
    appendMessage(graph, { id, parentId, role, content, complete: true, createdAt } as Parameters<typeof appendMessage>[1]);
  graph = add('u1', null, 'user', 'first question', '2026-10-14T12:00:00.000Z');
  graph = add('a1', 'u1', 'assistant', 'first answer', '2026-10-14T12:01:00.000Z');
  graph = add('u2', 'u1', 'user', 'edited question', '2026-10-14T12:02:00.000Z');
  graph = add('a2', 'u2', 'assistant', 'second answer', '2026-10-14T12:03:00.000Z');
  graph = add('u3', 'a2', 'user', 'follow-up question', '2026-10-14T12:04:00.000Z');
  return graph;
}

function fakeStorage(values = new Map<string, string>()): Storage {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  } as Storage;
}

describe('message delete planning', () => {
  test('a forked root takes its whole subtree and offers the wider scope', () => {
    const plan = planMessageDelete(graphFixture(), 'u1');
    expect(plan).not.toBeNull();
    expect(plan!.messageIds).toEqual(['u1', 'a1', 'u2', 'a2', 'u3']);
    expect(plan!.replyCount).toBe(4);
    expect(plan!.branchPoint).toBe(true);
  });

  test('an edited branch counts every reply below it', () => {
    const plan = planMessageDelete(graphFixture(), 'u2');
    expect(plan!.messageIds).toEqual(['u2', 'a2', 'u3']);
    expect(plan!.replyCount).toBe(2);
    expect(plan!.branchPoint).toBe(true);
  });

  test('a reply beside a fork is still marked as a branch point', () => {
    const plan = planMessageDelete(graphFixture(), 'a1');
    expect(plan).toEqual({ messageIds: ['a1'], replyCount: 0, branchPoint: true });
  });

  test('a message in a straight chain plans without the wider scope', () => {
    const plan = planMessageDelete(graphFixture(), 'a2');
    expect(plan).toEqual({ messageIds: ['a2', 'u3'], replyCount: 1, branchPoint: false });
    expect(planMessageDelete(graphFixture(), 'u3')).toEqual({ messageIds: ['u3'], replyCount: 0, branchPoint: false });
  });

  test('an unknown message plans nothing', () => {
    expect(planMessageDelete(graphFixture(), 'missing')).toBeNull();
  });
});

describe('follow-up suggestions', () => {
  test('question lines in the answer become suggestions in reading order', () => {
    expect(deriveFollowUps('Sure thing.\nCan you explain the config file?\nHow do I reset the store?'))
      .toEqual(['Can you explain the config file?', 'How do I reset the store?']);
  });

  test('list items under a follow-up heading count as suggestions', () => {
    const content = 'Here is the plan.\n## Next steps\n- Update the driver\n- Restart the service\n- Check the logs';
    expect(deriveFollowUps(content)).toEqual(['Update the driver', 'Restart the service', 'Check the logs']);
  });

  test('a bold follow-up heading works like a markdown heading', () => {
    const content = 'Answer.\n**You could ask:**\n- What if I need more tokens?\n- How do I retry a failed run?';
    expect(deriveFollowUps(content)).toEqual(['What if I need more tokens?', 'How do I retry a failed run?']);
  });

  test('duplicates collapse case-insensitively and the limit is respected', () => {
    const content = 'What changed?\nwhat changed?\nWhere is the config?\nWho owns this service?';
    expect(deriveFollowUps(content)).toEqual(['What changed?', 'Where is the config?', 'Who owns this service?']);
    expect(deriveFollowUps(content, 2)).toEqual(['What changed?', 'Where is the config?']);
  });

  test('an answer without candidates suggests nothing', () => {
    expect(deriveFollowUps('The answer is 42.')).toEqual([]);
    expect(deriveFollowUps('')).toEqual([]);
  });

  test('an assistant greeting that ends with a question is not a follow-up chip', () => {
    expect(deriveFollowUps('Hey! How can I help you today?')).toEqual([]);
    expect(deriveFollowUps('How can I help you today?')).toEqual([]);
  });
});

describe('message ratings', () => {
  test('ratings round-trip per conversation and per message', () => {
    const storage = fakeStorage();
    writeRating('c1', 'a1', { value: 'up', reason: 'clear steps' }, storage);
    writeRating('c1', 'a2', { value: 'down', reason: '' }, storage);
    expect(readRatings('c1', storage)).toEqual({
      a1: { value: 'up', reason: 'clear steps' },
      a2: { value: 'down', reason: '' }
    });
    expect(readRatings('c2', storage)).toEqual({});
  });

  test('clearing one rating keeps the rest', () => {
    const storage = fakeStorage();
    writeRating('c1', 'a1', { value: 'up', reason: 'nice' }, storage);
    writeRating('c1', 'a2', { value: 'down', reason: '' }, storage);
    expect(writeRating('c1', 'a1', null, storage)).toEqual({ a2: { value: 'down', reason: '' } });
  });

  test('a stored reason is bounded to 500 characters', () => {
    const storage = fakeStorage();
    writeRating('c1', 'a1', { value: 'up', reason: 'x'.repeat(600) }, storage);
    expect(readRatings('c1', storage).a1!.reason).toHaveLength(500);
  });

  test('malformed storage reads as no ratings instead of throwing', () => {
    const values = new Map([['air-office:chat-ratings:c1', '{oops']]);
    expect(readRatings('c1', fakeStorage(values))).toEqual({});
  });

  test('unknown rating shapes are rejected', () => {
    expect(normalizeRating(null)).toBeNull();
    expect(normalizeRating({ value: 'sideways', reason: 'x' })).toBeNull();
    expect(normalizeRating(['up'])).toBeNull();
    expect(normalizeRating({ value: 'down', reason: 7 })).toEqual({ value: 'down', reason: '' });
  });
});
