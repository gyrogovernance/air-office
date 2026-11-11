import { expect, test } from 'bun:test';
import { closeVisitedWorkspace, traverseWorkspace, visitWorkspace, type WorkspaceNavigation } from '../../../apps/web/src/app/workspace-navigation.policy';
import type { StageState } from '@office/workspace/domain';

const surfaces: StageState['surfaces'] = [
  { id: 'fellowship', kind: 'fellowship', title: 'Fellowship' },
  { id: 'teams', kind: 'teams', title: 'Teams' },
  { id: 'craft', kind: 'craft', title: 'Craft' },
];
test('closing a restored view does not expose an old unvisited view', () => {
  const stage: StageState = { version: 1, surfaces, activeId: 'craft' };
  const closed = closeVisitedWorkspace(stage, { back: [], current: 'craft', forward: [] }, 'craft');
  expect(closed.activeId).toBeNull();
  expect(closed.surfaces.map((surface) => surface.id)).toEqual(['fellowship', 'teams']);
});
test('closing returns to the most recent available view visited this session', () => {
  const stage: StageState = { version: 1, surfaces, activeId: 'craft' };
  const closed = closeVisitedWorkspace(stage, { back: ['teams', 'fellowship'], current: 'craft', forward: [] }, 'craft');
  expect(closed.activeId).toBe('fellowship');
  expect(closeVisitedWorkspace(stage, { back: [], current: 'craft', forward: [] }, 'teams').activeId).toBe('craft');
});
test('closing skips a parked Welcome entry and keeps a visited surface', () => {
  const stage: StageState = { version: 1, surfaces, activeId: 'craft' };
  const closed = closeVisitedWorkspace(stage, { back: [null, 'fellowship'], current: 'craft', forward: [] }, 'craft');
  expect(closed.activeId).toBe('fellowship');
  expect(closed.surfaces.map((surface) => surface.id)).toEqual(['fellowship', 'teams']);
});
function visit(history: WorkspaceNavigation, activeId: string) {
  return visitWorkspace(history, { version: 1, surfaces, activeId });
}
test('back and forward retrace visits, and a new destination discards the forward branch', () => {
  let history: WorkspaceNavigation = { back: [], current: null, forward: [] };
  history = visit(visit(history, 'fellowship'), 'teams');
  history = traverseWorkspace(history, 'back');
  expect(history.current).toBe('fellowship');
  expect(traverseWorkspace(history, 'forward').current).toBe('teams');
  history = visit(history, 'craft');
  expect(history.forward).toEqual([]);
  expect(traverseWorkspace(history, 'back').current).toBe('fellowship');
});
test('same-view updates do not create visits and closing a view removes stale history targets', () => {
  const history = visit(visit({ back: [], current: null, forward: [] }, 'fellowship'), 'teams');
  expect(visit(history, 'teams').back).toEqual([null, 'fellowship']);
  const pruned = visitWorkspace(history, { version: 1, surfaces: surfaces.filter((surface) => surface.id !== 'fellowship'), activeId: 'teams' });
  expect(traverseWorkspace(pruned, 'back').current).toBeNull();
  expect(traverseWorkspace({ back: [], current: null, forward: [] }, 'back').current).toBeNull();
});
