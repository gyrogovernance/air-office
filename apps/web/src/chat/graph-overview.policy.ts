import type { ConversationGraph, ConversationMessage } from '@office/chat/domain';

export type OverviewLayout = 'vertical' | 'horizontal';

export interface GraphOverviewPreferences {
  layout: OverviewLayout;
  favoriteMessageIds: string[];
  viewportPinned: boolean;
}

export const DEFAULT_GRAPH_OVERVIEW_PREFERENCES: GraphOverviewPreferences = {
  layout: 'vertical',
  favoriteMessageIds: [],
  viewportPinned: false
};

function storageKey(conversationId: string): string {
  return `air-office:chat-graph:${conversationId}`;
}

export function normalizeGraphOverviewPreferences(value: unknown): GraphOverviewPreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_GRAPH_OVERVIEW_PREFERENCES };
  const record = value as Record<string, unknown>;
  const favoriteMessageIds = Array.isArray(record.favoriteMessageIds)
    ? [...new Set(record.favoriteMessageIds.filter((id): id is string => typeof id === 'string'))]
    : [];
  return {
    layout: record.layout === 'horizontal' ? 'horizontal' : 'vertical',
    favoriteMessageIds,
    viewportPinned: record.viewportPinned === true
  };
}

export function readGraphOverviewPreferences(conversationId: string, storage?: Storage): GraphOverviewPreferences {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(storageKey(conversationId));
    return raw ? normalizeGraphOverviewPreferences(JSON.parse(raw)) : { ...DEFAULT_GRAPH_OVERVIEW_PREFERENCES };
  } catch {
    return { ...DEFAULT_GRAPH_OVERVIEW_PREFERENCES };
  }
}

export function writeGraphOverviewPreferences(conversationId: string, preferences: GraphOverviewPreferences, storage?: Storage): void {
  try { (storage ?? globalThis.localStorage)?.setItem(storageKey(conversationId), JSON.stringify(normalizeGraphOverviewPreferences(preferences))); } catch { /* browser persistence is optional */ }
}

export function toggleFavorite(preferences: GraphOverviewPreferences, messageId: string): GraphOverviewPreferences {
  const favoriteMessageIds = preferences.favoriteMessageIds.includes(messageId)
    ? preferences.favoriteMessageIds.filter((id) => id !== messageId)
    : [...preferences.favoriteMessageIds, messageId];
  return { ...preferences, favoriteMessageIds };
}

export interface OverviewNodeData {
  message: ConversationMessage;
  favorite: boolean;
  selected: boolean;
}

/** Branch navigation: where one message sits among the siblings that share its parent. */
export interface MessageBranch {
  /** Every child of the same parent, oldest first, including this message. */
  siblingIds: string[];
  /** Position of this message inside that group. */
  index: number;
}

function oldestFirst(a: ConversationMessage, b: ConversationMessage): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * Locates the branch group a message belongs to. Messages with one sibling or
 * more share a fork point, so previous/next controls belong on them and walk
 * the graph the overview already projects.
 */
export function messageBranch(graph: ConversationGraph, messageId: string): MessageBranch | null {
  const target = graph.messages.find((message) => message.id === messageId);
  if (!target) return null;
  const siblingIds = graph.messages
    .filter((message) => message.parentId === target.parentId)
    .sort(oldestFirst)
    .map((message) => message.id);
  return { siblingIds, index: siblingIds.indexOf(messageId) };
}

/**
 * The newest end of the branch that starts at a message, so focusing a sibling
 * shows that sibling's whole continuation instead of stopping at the fork.
 */
export function branchLeafId(graph: ConversationGraph, messageId: string): string | null {
  if (!graph.messages.some((message) => message.id === messageId)) return null;
  const visited = new Set<string>([messageId]);
  let cursor = messageId;
  for (;;) {
    const next = graph.messages
      .filter((message) => message.parentId === cursor)
      .sort(oldestFirst)
      .at(-1);
    if (!next || visited.has(next.id)) return cursor;
    visited.add(next.id);
    cursor = next.id;
  }
}

export interface OverviewProjection {
  nodes: Array<{ id: string; type: 'chatMessage'; position: { x: number; y: number }; data: OverviewNodeData }>;
  edges: Array<{ id: string; source: string; target: string; type: 'smoothstep' }>;
}

export function projectGraphOverview(graph: ConversationGraph, preferences: GraphOverviewPreferences, selectedMessageId: string | null): OverviewProjection {
  const byParent = new Map<string | null, ConversationMessage[]>();
  for (const message of graph.messages) {
    const siblings = byParent.get(message.parentId) ?? [];
    siblings.push(message);
    byParent.set(message.parentId, siblings);
  }
  const levels = new Map<string, number>();
  const lanes = new Map<string, number>();
  const children = new Map<string, ConversationMessage[]>();
  let nextLane = 0;
  const roots = [...(byParent.get(null) ?? []), ...graph.messages];
  for (const root of roots) {
    if (levels.has(root.id)) continue;
    const stack = [{ message: root, level: 0, finish: false }];
    while (stack.length) {
      const entry = stack.pop()!;
      if (entry.finish) {
        const childLanes = (children.get(entry.message.id) ?? []).map((child) => lanes.get(child.id)!);
        lanes.set(entry.message.id, childLanes.length ? (childLanes[0]! + childLanes.at(-1)!) / 2 : nextLane++);
        continue;
      }
      if (levels.has(entry.message.id)) continue;
      levels.set(entry.message.id, entry.level);
      stack.push({ ...entry, finish: true });
      const descendants = (byParent.get(entry.message.id) ?? []).filter((child) => !levels.has(child.id));
      children.set(entry.message.id, descendants);
      for (const child of [...descendants].reverse()) stack.push({ message: child, level: entry.level + 1, finish: false });
    }
  }
  const nodes = graph.messages.map((message) => {
    const level = levels.get(message.id) ?? 0;
    const lane = lanes.get(message.id) ?? 0;
    const position = preferences.layout === 'horizontal'
      ? { x: level * 280, y: lane * 150 }
      : { x: lane * 260, y: level * 150 };
    return {
      id: message.id,
      type: 'chatMessage' as const,
      position,
      data: { message, favorite: preferences.favoriteMessageIds.includes(message.id), selected: message.id === selectedMessageId }
    };
  });
  const edges = graph.messages.filter((message) => message.parentId && graph.messages.some((candidate) => candidate.id === message.parentId)).map((message) => ({
    id: `${message.parentId}->${message.id}`,
    source: message.parentId!,
    target: message.id,
    type: 'smoothstep' as const
  }));
  return { nodes, edges };
}
