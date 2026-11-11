import type { StageState } from '@office/workspace/domain';

export function closeVisitedWorkspace(stage: StageState, history: WorkspaceNavigation, id: string): StageState {
  const surfaces = stage.surfaces.filter((surface) => surface.id !== id);
  if (stage.activeId !== id) return { ...stage, surfaces };
  // Prefer a real visited surface. `null` in history means Welcome; skip it so
  // a parked Welcome entry cannot blank the stage while other views remain.
  const previous = [...history.back].reverse().find((target) => target !== null && surfaces.some((surface) => surface.id === target)) ?? null;
  return { ...stage, surfaces, activeId: previous };
}

export interface WorkspaceNavigation {
  back: (string | null)[];
  current: string | null;
  forward: (string | null)[];
}

export function visitWorkspace(history: WorkspaceNavigation, stage: StageState): WorkspaceNavigation {
  const available = (id: string | null) => id === null || stage.surfaces.some((surface) => surface.id === id);
  const back = history.back.filter(available);
  const forward = history.forward.filter(available);
  if (history.current === stage.activeId) return { ...history, back, forward };
  return { back: [...back, ...(available(history.current) ? [history.current] : [])].slice(-100), current: stage.activeId, forward: [] };
}

export function traverseWorkspace(history: WorkspaceNavigation, direction: 'back' | 'forward'): WorkspaceNavigation {
  const source = history[direction];
  if (source.length === 0) return history;
  const current = source[source.length - 1] ?? null;
  return direction === 'back'
    ? { back: source.slice(0, -1), current, forward: [...history.forward, history.current] }
    : { back: [...history.back, history.current], current, forward: source.slice(0, -1) };
}
