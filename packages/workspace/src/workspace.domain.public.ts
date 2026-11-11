export { WorkspaceError } from './workspace-catalog.domain.public';
export type { WorkspaceNode, WorkspaceNodeInput, WorkspaceNodeUpdate, WorkspaceMove, WorkspaceOrganization, WorkspaceRemoval } from './workspace-catalog.domain.public';

export interface WorkspaceState {
  authorized: boolean;
  activeFileId: string | null;
}

export const stageSurfaceCatalog = {
  'chat-stage': { owner: 'chat', featureId: 'F-004', uiEntrypoint: 'apps/web/src/chat/chat-rail.component.tsx', persistence: 'service-owned conversation and composer draft' },
  programs: { owner: 'workspace', featureId: 'F-001', uiEntrypoint: 'apps/web/src/app/programs-workspace.component.tsx', persistence: 'service-owned programs and projects; stage descriptor' },
  arcade: { owner: 'workspace', featureId: 'F-001', uiEntrypoint: 'apps/web/src/arcade-workspace.component.tsx', persistence: 'stage descriptor; bundled LittleJS Arcade owns local game scores and preferences' },
  code: { owner: 'workspace', featureId: 'F-009', uiEntrypoint: 'apps/web/src/app/code-workspace.component.tsx', persistence: 'stage descriptor; supervised code-server workbench; folder chosen after open' },
  document: { owner: 'editor', featureId: 'F-002', uiEntrypoint: 'apps/web/src/workspace-shell.component.tsx', persistence: 'stage descriptor; editor-owned recoverable draft' },
  'knowledge-source': { owner: 'knowledge', featureId: 'F-006', uiEntrypoint: 'apps/web/src/knowledge/knowledge-source-view.component.tsx', persistence: 'stage descriptor; retained source owned by documents' },
  'rich-document': { owner: 'editor', featureId: 'F-003', uiEntrypoint: 'apps/web/src/workspace-shell.component.tsx', persistence: 'vault programs/*/notes/*.note.json with paired markdown projection; editor-owned recoverable draft' },
  methods: { owner: 'methods', featureId: 'F-007', uiEntrypoint: 'apps/web/src/methods-workspace.component.tsx', persistence: 'service-owned method definitions and versions' },
  today: { owner: 'workspace', featureId: 'F-001', uiEntrypoint: 'apps/web/src/today-briefing.component.tsx', persistence: 'stage descriptor; browser briefing draft; explicit save through editor service' },
  calendar: { owner: 'calendar', featureId: 'F-013', uiEntrypoint: 'apps/web/src/calendar-workspace.component.tsx', persistence: 'service-owned calendar lists and events' },
  teams: { owner: 'methods', featureId: 'F-007', uiEntrypoint: 'apps/web/src/teams-workspace.component.tsx', persistence: 'service-owned agent definitions and versions' },
  market: { owner: 'workspace', featureId: 'F-016', uiEntrypoint: 'apps/web/src/market-workspace.component.tsx', persistence: 'portable packages; installed resources owned by their modules' },
  media: { owner: 'providers', featureId: 'F-005', uiEntrypoint: 'apps/web/src/workplace-media-workspace.component.tsx', persistence: 'transient generated media with explicit download' },
  search: { owner: 'workspace', featureId: 'F-001', uiEntrypoint: 'apps/web/src/workspace-search.component.tsx', persistence: 'stage descriptor and transient query' },
  apps: { owner: 'lab-pack', featureId: 'F-008', uiEntrypoint: 'apps/web/src/apps-workspace.component.tsx', persistence: 'stage descriptor; Lab pack catalog from the service' },
  fellowship: { owner: 'workspace', featureId: 'F-008', uiEntrypoint: 'apps/web/src/fellowship-workspace.component.tsx', persistence: 'stage descriptor; public Fellowship membership remains in AIR-Craft Discussions' },
  craft: { owner: 'workspace', featureId: 'F-008', uiEntrypoint: 'apps/web/src/fellowship-workspace.component.tsx', persistence: 'stage descriptor; public submissions remain in AIR-Craft Issues' },
  prompts: { owner: 'methods', featureId: 'F-007', uiEntrypoint: 'apps/web/src/prompts-workspace.component.tsx', persistence: 'service-owned prompt definitions' },
  glossary: { owner: 'lab-pack', featureId: 'F-008', uiEntrypoint: 'apps/web/src/glossary-workspace.component.tsx', persistence: 'stage descriptor; glossary entries from the Lab pack' },
  settings: { owner: 'workspace', featureId: 'F-001', uiEntrypoint: 'apps/web/src/workspace-shell.component.tsx', persistence: 'stage descriptor and active identity' }
} as const;

export type StageSurface =
  | { id: 'chat-stage'; kind: 'chat-stage'; title: string }
  | { id: 'programs'; kind: 'programs'; title: string }
  | { id: 'arcade'; kind: 'arcade'; title: string }
  | { id: 'code'; kind: 'code'; title: string }
  | { id: string; kind: 'document'; title: string; fileId: string }
  | { id: string; kind: 'rich-document'; title: string; fileId: string }
  | { id: string; kind: 'file-preview'; title: string; fileId: string }
  | { id: string; kind: 'knowledge-source'; title: string; fileId: string }
  | { id: 'methods'; kind: 'methods'; title: string }
  | { id: 'settings'; kind: 'settings'; title: string }
  | { id: 'today'; kind: 'today'; title: string }
  | { id: 'calendar'; kind: 'calendar'; title: string }
  | { id: 'teams'; kind: 'teams'; title: string }
  | { id: 'market'; kind: 'market'; title: string }
  | { id: 'media'; kind: 'media'; title: string }
  | { id: 'search'; kind: 'search'; title: string }
  | { id: 'apps'; kind: 'apps'; title: string }
  | { id: 'fellowship'; kind: 'fellowship'; title: string }
  | { id: 'craft'; kind: 'craft'; title: string }
  | { id: 'prompts'; kind: 'prompts'; title: string }
  | { id: 'glossary'; kind: 'glossary'; title: string };
export interface StageState {
  version: 1;
  surfaces: StageSurface[];
  activeId: string | null;
}

export function restoreStageState(value: unknown, legacyActiveId: string | null = null): StageState {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const candidates = Array.isArray(value) ? value : record?.version === 1 && Array.isArray(record.surfaces) ? record.surfaces : [];
  const surfaces: StageSurface[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const item = candidate as Record<string, unknown>;
    if (typeof item.title !== 'string') continue;
    let surface: StageSurface | null;
    if (item.kind === 'chat-stage') surface = { id: 'chat-stage', kind: 'chat-stage', title: item.title };
    else if (item.kind === 'programs') surface = { id: 'programs', kind: 'programs', title: item.title };
    else if (item.kind === 'arcade') surface = { id: 'arcade', kind: 'arcade', title: item.title };
    else if (item.kind === 'code') surface = { id: 'code', kind: 'code', title: item.title };
    else if (item.kind === 'today') surface = { id: 'today', kind: 'today', title: item.title };
    else if (item.kind === 'calendar') surface = { id: 'calendar', kind: 'calendar', title: item.title };
    else if (item.kind === 'teams') surface = { id: 'teams', kind: 'teams', title: item.title };
    else if (item.kind === 'market') surface = { id: 'market', kind: 'market', title: item.title };
    else if (item.kind === 'media') surface = { id: 'media', kind: 'media', title: item.title };
    else if (item.kind === 'search') surface = { id: 'search', kind: 'search', title: item.title };
    else if (item.kind === 'apps') surface = { id: 'apps', kind: 'apps', title: item.title };
    else if (item.kind === 'fellowship') surface = { id: 'fellowship', kind: 'fellowship', title: item.title };
    else if (item.kind === 'craft') surface = { id: 'craft', kind: 'craft', title: item.title };
    else if (item.kind === 'prompts') surface = { id: 'prompts', kind: 'prompts', title: item.title };
    else if (item.kind === 'glossary') surface = { id: 'glossary', kind: 'glossary', title: item.title };
    else if (item.kind === 'settings') surface = { id: 'settings', kind: 'settings', title: item.title };
    else if (item.kind === 'methods') surface = { id: 'methods', kind: 'methods', title: item.title };
    else if ((item.kind === 'document' || item.kind === 'rich-document' || item.kind === 'file-preview' || item.kind === 'knowledge-source') && typeof item.fileId === 'string' && item.fileId.length > 0) surface = { id: item.fileId, kind: item.kind, title: item.title, fileId: item.fileId };
    else surface = null;
    if (surface && !surfaces.some((current) => current.id === surface.id)) surfaces.push(surface);
  }
  const requested = Array.isArray(value) ? legacyActiveId : record?.activeId;
  return { version: 1, surfaces, activeId: record?.version === 1 && requested === null ? null : surfaces.find((surface) => surface.id === requested)?.id ?? surfaces[0]?.id ?? null };
}

export function openStageSurface(state: StageState, surface: StageSurface): StageState {
  return { ...state, surfaces: state.surfaces.some((item) => item.id === surface.id) ? state.surfaces : [...state.surfaces, surface], activeId: surface.id };
}

export function closeStageSurface(state: StageState, id: string): StageState {
  const index = state.surfaces.findIndex((surface) => surface.id === id);
  const surfaces = state.surfaces.filter((surface) => surface.id !== id);
  return { ...state, surfaces, activeId: state.activeId === id ? surfaces[Math.min(index, surfaces.length - 1)]?.id ?? null : state.activeId };
}

export function reconcileStageScope(state: StageState, fileIds: readonly string[], resetDocuments = false): StageState {
  const surfaces = state.surfaces.filter((surface) => surface.kind !== 'document' || (!resetDocuments && fileIds.includes(surface.fileId)));
  return { ...state, surfaces, activeId: state.activeId === null || surfaces.some((surface) => surface.id === state.activeId) ? state.activeId : surfaces[0]?.id ?? null };
}
