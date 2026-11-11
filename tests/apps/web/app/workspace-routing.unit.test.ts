import { describe, expect, test } from 'bun:test';
import { parseWorkspaceRoute, settingsPath, workspacePath } from '../../../../apps/web/src/app/workspace-routing.policy';

describe('workspace routes', () => {
  test('root is the welcome destination', () => {
    expect(parseWorkspaceRoute('/')).toEqual({ kind: 'welcome' });
  });

  test('surface paths round-trip with supported state', () => {
    expect(parseWorkspaceRoute(workspacePath('calendar', '2026-03-18'))).toEqual({ kind: 'surface', id: 'calendar', date: '2026-03-18' });
    expect(parseWorkspaceRoute('/apps/programs')).toEqual({ kind: 'surface', id: 'programs' });
    expect(parseWorkspaceRoute(workspacePath('code'))).toEqual({ kind: 'surface', id: 'code' });
  });

  test('settings paths validate sections and preserve create intent', () => {
    expect(settingsPath('apps', 'create')).toBe('/settings/apps?action=create');
    expect(parseWorkspaceRoute('/settings/apps', '?action=create')).toEqual({ kind: 'settings', section: 'apps', action: 'create' });
    expect(parseWorkspaceRoute('/settings/not-a-section')).toEqual({ kind: 'welcome' });
  });

  test('unknown app paths do not activate a stage', () => {
    expect(parseWorkspaceRoute('/apps/not-an-app')).toEqual({ kind: 'welcome' });
    expect(parseWorkspaceRoute('/settings/apps/extra')).toEqual({ kind: 'welcome' });
  });
});