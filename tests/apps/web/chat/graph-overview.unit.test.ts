import { describe, expect, test } from 'bun:test';
import { appendMessage, createConversationGraph } from '@office/chat/domain';
import {
  branchLeafId,
  DEFAULT_GRAPH_OVERVIEW_PREFERENCES,
  messageBranch,
  normalizeGraphOverviewPreferences,
  projectGraphOverview,
  readGraphOverviewPreferences,
  toggleFavorite,
  writeGraphOverviewPreferences
} from '../../../../apps/web/src/chat/graph-overview.policy';

function graphFixture() {
  let graph = createConversationGraph('c1');
  const add = (id: string, parentId: string | null, role: 'user' | 'assistant', content: string, createdAt: string) =>
    appendMessage(graph, { id, parentId, role, content, complete: true, createdAt } as Parameters<typeof appendMessage>[1]);
  graph = add('u1', null, 'user', 'first question', '2026-10-14T12:00:00.000Z');
  graph = add('a1', 'u1', 'assistant', 'first answer', '2026-10-14T12:01:00.000Z');
  graph = add('u2', 'u1', 'user', 'edited question', '2026-10-14T12:02:00.000Z');
  graph = add('a2', 'u2', 'assistant', 'second answer', '2026-10-14T12:03:00.000Z');
  return graph;
}

describe('graph overview preferences', () => {
  test('normalizes unknown or malformed input to defaults', () => {
    expect(normalizeGraphOverviewPreferences(null)).toEqual(DEFAULT_GRAPH_OVERVIEW_PREFERENCES);
    expect(normalizeGraphOverviewPreferences('garbage')).toEqual(DEFAULT_GRAPH_OVERVIEW_PREFERENCES);
    expect(normalizeGraphOverviewPreferences({ layout: 'sideways', favoriteMessageIds: [1, 'a', 'a'], viewportPinned: 'yes' }))
      .toEqual({ layout: 'vertical', favoriteMessageIds: ['a'], viewportPinned: false });
  });

  test('round-trips preferences through storage', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } } as Storage;
    writeGraphOverviewPreferences('c1', { layout: 'horizontal', favoriteMessageIds: ['a1'], viewportPinned: true }, storage);
    expect(readGraphOverviewPreferences('c1', storage)).toEqual({ layout: 'horizontal', favoriteMessageIds: ['a1'], viewportPinned: true });
  });

  test('toggleFavorite adds and removes without duplicates', () => {
    const withA1 = toggleFavorite(DEFAULT_GRAPH_OVERVIEW_PREFERENCES, 'a1');
    expect(withA1.favoriteMessageIds).toEqual(['a1']);
    expect(toggleFavorite(withA1, 'a1').favoriteMessageIds).toEqual([]);
  });
});

describe('graph overview projection', () => {
  test('projects every message as a node with parent edges', () => {
    const projection = projectGraphOverview(graphFixture(), DEFAULT_GRAPH_OVERVIEW_PREFERENCES, null);
    expect(projection.nodes.map((n) => n.id).sort()).toEqual(['a1', 'a2', 'u1', 'u2']);
    const edgePairs = projection.edges.map((e) => `${e.source}->${e.target}`).sort();
    expect(edgePairs).toEqual(['u1->a1', 'u1->u2', 'u2->a2']);
  });

  test('marks the selected node', () => {
    const projection = projectGraphOverview(graphFixture(), DEFAULT_GRAPH_OVERVIEW_PREFERENCES, 'a2');
    const selected = projection.nodes.filter((n) => n.data.selected).map((n) => n.id);
    expect(selected).toEqual(['a2']);
  });

  test('horizontal layout swaps axes', () => {
    const v = projectGraphOverview(graphFixture(), DEFAULT_GRAPH_OVERVIEW_PREFERENCES, null);
    const h = projectGraphOverview(graphFixture(), { ...DEFAULT_GRAPH_OVERVIEW_PREFERENCES, layout: 'horizontal' }, null);
    const rootNode = v.nodes.find((n) => n.id === 'u1')!;
    const hRootNode = h.nodes.find((n) => n.id === 'u1')!;
    expect(rootNode.position.x).not.toBe(rootNode.position.y);
    expect(hRootNode.position.x).not.toBe(hRootNode.position.y);
  });
});

describe('message branch navigation', () => {
  test('locates a message among its siblings oldest first', () => {
    const graph = graphFixture();
    expect(messageBranch(graph, 'a1')).toEqual({ siblingIds: ['a1', 'u2'], index: 0 });
    expect(messageBranch(graph, 'u2')).toEqual({ siblingIds: ['a1', 'u2'], index: 1 });
  });

  test('a lone member still reports its group so the control can stay hidden', () => {
    const graph = graphFixture();
    expect(messageBranch(graph, 'a2')).toEqual({ siblingIds: ['a2'], index: 0 });
    expect(messageBranch(graph, 'u1')).toEqual({ siblingIds: ['u1'], index: 0 });
    expect(messageBranch(graph, 'missing')).toBeNull();
  });
});

describe('branch leaf', () => {
  test('walks to the newest descendant of a branch', () => {
    const graph = graphFixture();
    expect(branchLeafId(graph, 'u1')).toBe('a2');
    expect(branchLeafId(graph, 'u2')).toBe('a2');
    expect(branchLeafId(graph, 'a2')).toBe('a2');
  });

  test('the older sibling branch keeps its own leaf and unknown ids resolve to nothing', () => {
    const graph = graphFixture();
    expect(branchLeafId(graph, 'a1')).toBe('a1');
    expect(branchLeafId(graph, 'missing')).toBeNull();
  });
});
