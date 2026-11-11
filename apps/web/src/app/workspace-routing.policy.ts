import { settingsSections, type SettingsSection } from '../settings/settings.policy';

export type WorkspaceRoute =
  | { kind: 'welcome' }
  | { kind: 'chat' }
  | { kind: 'settings'; section: SettingsSection; action?: 'create' }
  | { kind: 'surface'; id: WorkspaceSurfaceId; date?: string };

export type WorkspaceSurfaceId =
  | 'programs' | 'arcade' | 'code' | 'today' | 'calendar' | 'teams' | 'market'
  | 'media' | 'search' | 'apps' | 'fellowship' | 'craft' | 'prompts' | 'glossary';

const surfaceIds = new Set<WorkspaceSurfaceId>([
  'programs', 'arcade', 'code', 'today', 'calendar', 'teams', 'market', 'media', 'search',
  'apps', 'fellowship', 'craft', 'prompts', 'glossary',
]);

const settingsSectionIds = new Set<SettingsSection>(settingsSections.map((section) => section.id));
for (const section of ['market', 'automations', 'cloud-ai'] satisfies SettingsSection[]) settingsSectionIds.add(section);

export function isWorkspaceSurfaceId(value: string): value is WorkspaceSurfaceId {
  return surfaceIds.has(value as WorkspaceSurfaceId);
}

function isSettingsSection(value: string): value is SettingsSection {
  return settingsSectionIds.has(value as SettingsSection);
}

export function parseWorkspaceRoute(pathname: string, search = ''): WorkspaceRoute {
  const [path, embeddedSearch = ''] = pathname.split('?', 2);
  const paramsSearch = search || (embeddedSearch ? `?${embeddedSearch}` : '');
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { kind: 'welcome' };
  if (parts[0] === 'chat') return { kind: 'chat' };
  if (parts[0] === 'settings' && parts.length <= 2) {
    const section = parts[1] ?? 'dashboard';
    if (!isSettingsSection(section)) return { kind: 'welcome' };
    const params = new URLSearchParams(paramsSearch);
    return { kind: 'settings', section, ...(params.get('action') === 'create' ? { action: 'create' } : {}) };
  }
  if (parts[0] === 'apps' && parts.length === 2 && isWorkspaceSurfaceId(parts[1]!)) {
    const params = new URLSearchParams(paramsSearch);
    const date = params.get('date') ?? undefined;
    return { kind: 'surface', id: parts[1], ...(date ? { date } : {}) };
  }
  return { kind: 'welcome' };
}

export function workspacePath(id: WorkspaceSurfaceId, date?: string): string {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  return `/apps/${id}${query}`;
}

export function settingsPath(section: SettingsSection = 'dashboard', action?: 'create'): string {
  return `/settings/${section}${action === 'create' ? '?action=create' : ''}`;
}
