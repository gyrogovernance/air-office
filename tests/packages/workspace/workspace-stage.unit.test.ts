import { expect, test } from 'bun:test';
import { closeStageSurface, openStageSurface, reconcileStageScope, restoreStageState, type StageSurface } from '../../../packages/workspace/src/workspace.domain.public';

const a: StageSurface = { id: 'a', fileId: 'a', title: 'A', kind: 'document' };
const b: StageSurface = { id: 'b', fileId: 'b', title: 'B', kind: 'document' };
const settings: StageSurface = { id: 'settings', title: 'Settings', kind: 'settings' };
test('an explicitly empty stage stays empty across restore and scope reconciliation', () => {
  const state = { version: 1, surfaces: [a, settings], activeId: null };
  const restored = restoreStageState(state);
  expect(restored.activeId).toBeNull();
  expect(reconcileStageScope(restored, ['a']).activeId).toBeNull();
  expect(restored.surfaces).toEqual([a, settings]);
});
test('Arcade restores, survives scope changes and closes back to the document', () => {
  const arcade: StageSurface = { id: 'arcade', kind: 'arcade', title: 'Arcade' };
  const state = openStageSurface(restoreStageState([a], 'a'), arcade);
  expect(restoreStageState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  expect(reconcileStageScope(state, [a.fileId]).activeId).toBe('arcade');
  expect(closeStageSurface(state, 'arcade')).toEqual({ version: 1, surfaces: [a], activeId: a.id });
});
test('Code restores, survives scope changes and closes back to the document', () => {
  const code: StageSurface = { id: 'code', kind: 'code', title: 'Code' };
  const state = openStageSurface(restoreStageState([a], 'a'), code);
  expect(restoreStageState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  expect(reconcileStageScope(state, [a.fileId]).activeId).toBe('code');
  expect(closeStageSurface(state, 'code')).toEqual({ version: 1, surfaces: [a], activeId: a.id });
});
test('Teams and Market open independently, survive reload and file-scope changes, and close normally', () => {
  const teams: StageSurface = { id: 'teams', kind: 'teams', title: 'Teams' };
  const market: StageSurface = { id: 'market', kind: 'market', title: 'Market' };
  const state = openStageSurface(openStageSurface(restoreStageState(null), teams), market);
  expect(restoreStageState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  expect(reconcileStageScope(state, [], true)).toEqual(state);
  expect(closeStageSurface(state, 'market')).toEqual({ version: 1, surfaces: [teams], activeId: 'teams' });
});
test('ordered surfaces and active Settings round-trip atomically', () => {
  const stage = openStageSurface(openStageSurface(openStageSurface(restoreStageState(null), a), b), settings);
  expect(restoreStageState(JSON.parse(JSON.stringify(stage)))).toEqual(stage);
  expect(openStageSurface(stage, a).surfaces).toEqual([a, b, settings]);
});
test('legacy state migrates, deduplicates, and rejects malformed descriptors', () => {
  expect(restoreStageState([a, a, null, { kind: 'document' }, settings], 'settings')).toEqual({ version: 1, surfaces: [a, settings], activeId: 'settings' });
  expect(restoreStageState({ version: 9, surfaces: [a] }).surfaces).toEqual([]);
  expect(restoreStageState([a, b], 'missing').activeId).toBe('a');
});
test('closing selects an adjacent surface and preserves inactive selection', () => {
  const stage = restoreStageState([a, b, settings], 'b');
  expect(closeStageSurface(stage, 'b').activeId).toBe('settings');
  expect(closeStageSurface(stage, 'a').activeId).toBe('b');
  expect(closeStageSurface(restoreStageState([a], 'a'), 'a').activeId).toBeNull();
});
test('scope reconciliation removes unavailable documents and retains Settings', () => {
  const stage = restoreStageState([a, b, settings], 'b');
  expect(reconcileStageScope(stage, ['a'])).toEqual({ version: 1, surfaces: [a, settings], activeId: 'a' });
  expect(reconcileStageScope(stage, ['a', 'b'], true)).toEqual({ version: 1, surfaces: [settings], activeId: 'settings' });
});
test('rich notes and the methods surface survive a file scope change and restore', () => {
  const note: StageSurface = { id: 'note-1', fileId: 'note-1', title: 'Note', kind: 'rich-document' };
  const methods: StageSurface = { id: 'methods', title: 'Methods', kind: 'methods' };
  const stage = restoreStageState([a, note, methods], 'note-1');
  expect(reconcileStageScope(stage, [], true)).toEqual({ version: 1, surfaces: [note, methods], activeId: 'note-1' });
  expect(restoreStageState(JSON.parse(JSON.stringify(stage)))).toEqual(stage);
});
test('Today survives reload and file scope changes and closes back to the open document', () => {
  const stage = openStageSurface(restoreStageState([a], 'a'), { id: 'today', kind: 'today', title: 'Today' });
  expect(restoreStageState(JSON.parse(JSON.stringify(stage)))).toEqual({ version: 1, surfaces: [a, { id: 'today', kind: 'today', title: 'Today' }], activeId: 'today' });
  expect(reconcileStageScope(stage, [], true)).toEqual({ version: 1, surfaces: [{ id: 'today', kind: 'today', title: 'Today' }], activeId: 'today' });
  expect(closeStageSurface(stage, 'today')).toEqual({ version: 1, surfaces: [a], activeId: 'a' });
});
test('Calendar restores as a single stage surface independent of file scope', () => {
  const calendar: StageSurface = { id: 'calendar', kind: 'calendar', title: 'Calendar' };
  const stage = openStageSurface(restoreStageState([a], 'a'), calendar);
  expect(restoreStageState(JSON.parse(JSON.stringify(stage)))).toEqual({ version: 1, surfaces: [a, calendar], activeId: 'calendar' });
  expect(reconcileStageScope(stage, [], true)).toEqual({ version: 1, surfaces: [calendar], activeId: 'calendar' });
  expect(closeStageSurface(stage, 'calendar')).toEqual({ version: 1, surfaces: [a], activeId: 'a' });
});

test('apps and glossary stage surfaces restore and close', () => {
  const apps: StageSurface = { id: 'apps', kind: 'apps', title: 'Apps' };
  const glossary: StageSurface = { id: 'glossary', kind: 'glossary', title: 'Glossary' };
  const stage = openStageSurface(openStageSurface(restoreStageState(null), apps), glossary);
  expect(restoreStageState(JSON.parse(JSON.stringify(stage)))).toEqual(stage);
  expect(closeStageSurface(stage, 'glossary')).toEqual({ version: 1, surfaces: [apps], activeId: 'apps' });
});

test('Fellowship and Craft restore independently of the active file scope', () => {
  const fellowship: StageSurface = { id: 'fellowship', kind: 'fellowship', title: 'Fellowship' };
  const craft: StageSurface = { id: 'craft', kind: 'craft', title: 'Craft' };
  const stage = openStageSurface(openStageSurface(restoreStageState([a], 'a'), fellowship), craft);
  expect(restoreStageState(JSON.parse(JSON.stringify(stage)))).toEqual(stage);
  expect(reconcileStageScope(stage, [], true)).toEqual({ version: 1, surfaces: [fellowship, craft], activeId: 'craft' });
  expect(closeStageSurface(stage, 'craft')).toEqual({ version: 1, surfaces: [a, fellowship], activeId: 'fellowship' });
});


test('the Prompts page restores and stays independent of file scope', () => {
  const state = restoreStageState({ version: 1, activeId: 'prompts', surfaces: [{ id: 'prompts', kind: 'prompts', title: 'Prompts' }] });
  expect(state.activeId).toBe('prompts');
  expect(reconcileStageScope(state, []).surfaces).toEqual([{ id: 'prompts', kind: 'prompts', title: 'Prompts' }]);
});
