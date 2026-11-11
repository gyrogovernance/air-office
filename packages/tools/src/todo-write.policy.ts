export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
};

const STATUSES = new Set<TodoStatus>(['pending', 'in_progress', 'completed', 'cancelled']);

/** Merge-by-id checklist update. At most one in_progress after merge. */
export function mergeTodos(current: readonly TodoItem[], incoming: readonly TodoItem[]): TodoItem[] {
  if (!Array.isArray(incoming) || incoming.length === 0) throw new Error('Provide at least one todo.');
  const byId = new Map(current.map((item) => [item.id, { ...item }]));
  const order = current.map((item) => item.id);
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') throw new Error('Each todo must be an object.');
    const id = String(raw.id ?? '').trim();
    const content = String(raw.content ?? '').trim();
    const status = raw.status as TodoStatus;
    if (!id) throw new Error('Each todo needs an id.');
    if (!content) throw new Error('Each todo needs content.');
    if (!STATUSES.has(status)) throw new Error('Todo status must be pending, in_progress, completed, or cancelled.');
    if (!byId.has(id)) order.push(id);
    byId.set(id, { id, content, status });
  }
  const merged = order.map((id) => byId.get(id)!).filter(Boolean);
  const inProgress = merged.filter((item) => item.status === 'in_progress');
  if (inProgress.length > 1) {
    throw new Error('At most one todo may be in_progress.');
  }
  return merged;
}
