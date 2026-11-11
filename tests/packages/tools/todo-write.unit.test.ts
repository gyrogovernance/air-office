import { describe, expect, test } from 'bun:test';
import { mergeTodos } from '../../../packages/tools/src/todo-write.policy';

describe('todo_write merge', () => {
  test('merges by id and keeps order', () => {
    const first = mergeTodos([], [
      { id: 'a', content: 'One', status: 'pending' },
      { id: 'b', content: 'Two', status: 'in_progress' },
    ]);
    expect(first).toHaveLength(2);
    const next = mergeTodos(first, [
      { id: 'b', content: 'Two done', status: 'completed' },
      { id: 'c', content: 'Three', status: 'pending' },
    ]);
    expect(next.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(next[1]).toEqual({ id: 'b', content: 'Two done', status: 'completed' });
  });

  test('refuses more than one in_progress', () => {
    expect(() => mergeTodos([], [
      { id: 'a', content: 'One', status: 'in_progress' },
      { id: 'b', content: 'Two', status: 'in_progress' },
    ])).toThrow(/one todo/i);
  });
});
