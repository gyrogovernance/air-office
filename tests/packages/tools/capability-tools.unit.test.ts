import { expect, test } from 'bun:test';
import { blockedInChat, createBuiltinDefinitions, defaultChatToolIds, invocationInput, selectEnabledTools } from '../../../packages/tools/src/tools.domain.public';
import { createToolsService } from '../../../packages/tools/src/tools.service.public';
import type { ToolStore } from '../../../packages/tools/src/tool-store.port';
import type { ToolConnection, ToolDefinition } from '@office/contracts/tool';

function memoryStore(): ToolStore {
  const connections = new Map<string, ToolConnection>();
  const definitions = new Map<string, ToolDefinition>();
  return {
    connections: () => [...connections.values()],
    definitions: (connectionId) => [...definitions.values()].filter((item) => connectionId === undefined || item.connectionId === connectionId),
    saveConnection: (connection) => { connections.set(connection.id, connection); },
    saveDefinition: (definition) => { definitions.set(definition.id, definition); },
    removeDefinition: (toolId) => { definitions.delete(toolId); },
    clearPersonalData: () => { connections.clear(); definitions.clear(); },
    close: () => undefined
  };
}

test('selectEnabledTools keeps only ids present in the live enabled catalog', () => {
  const enabled = createBuiltinDefinitions().filter((definition) => definition.enabled);
  const selected = selectEnabledTools(
    ['builtin:view', 'missing-tool', 'builtin:view', 'builtin:web-search', ''],
    enabled,
  );
  expect(selected.map((tool) => tool.id)).toEqual(['builtin:view', 'builtin:web-search']);
});

test('the capability builtins are catalogued with their documented names, effects, and defaults', () => {
  const byId = new Map(createBuiltinDefinitions().map((definition) => [definition.id, definition]));
  expect(byId.get('builtin:generate-image')).toMatchObject({ name: 'generate_image', effect: 'read', enabled: true });
  expect(byId.get('builtin:run-code')).toMatchObject({ name: 'run_code', effect: 'mutate', enabled: false });
  expect(byId.get('builtin:memory-search')).toMatchObject({ name: 'memory_search', effect: 'read', enabled: true });
  expect(byId.get('builtin:memory-remember')).toMatchObject({ name: 'memory_remember', effect: 'mutate', enabled: true });
  expect(byId.get('builtin:memory-update')).toMatchObject({ name: 'memory_update', effect: 'mutate', enabled: true });
  expect(byId.get('builtin:memory-forget')).toMatchObject({ name: 'memory_forget', effect: 'mutate', enabled: true });
  expect(byId.get('builtin:view')).toMatchObject({ name: 'view', effect: 'read', enabled: true });
  expect(byId.get('builtin:create')).toMatchObject({ name: 'create', effect: 'mutate', enabled: true });
  expect(byId.get('builtin:edit')).toMatchObject({ name: 'edit', effect: 'mutate', enabled: true });
  expect(byId.get('builtin:action-run')).toMatchObject({ name: 'action_run', effect: 'read', enabled: true });
  expect(byId.get('builtin:schedule-run')!.inputSchema.required).toEqual(['path']);
  expect(byId.get('builtin:action-run')!.inputSchema.required).toEqual(['path', 'source']);
  expect(byId.has('builtin:list-notes')).toBe(false);
  expect(byId.has('builtin:read-file')).toBe(false);
  expect(byId.has('builtin:memory-read')).toBe(false);
  expect(byId.has('builtin:actions-read')).toBe(false);
  expect(byId.get('builtin:web-search')).toMatchObject({ name: 'web_search', effect: 'read', enabled: true });
  expect(byId.get('builtin:web-fetch')).toMatchObject({ name: 'web_fetch', effect: 'read', enabled: true });
  expect(byId.get('builtin:web-fetch')!.inputSchema.required).toEqual(['url']);
  expect(byId.get('builtin:knowledge-search')).toMatchObject({ name: 'knowledge_search', effect: 'read', enabled: true });
  expect(byId.get('builtin:open-path')).toMatchObject({ name: 'open_path', effect: 'read', enabled: true });
  expect(byId.get('builtin:open-in-code')).toMatchObject({ name: 'open_in_code', effect: 'read', enabled: true });
  expect(byId.get('builtin:calendar-list')).toMatchObject({ name: 'calendar_list', effect: 'read', enabled: true });
  expect(byId.get('builtin:todo-write')).toMatchObject({ name: 'todo_write', effect: 'read', enabled: true });
  expect(byId.get('builtin:delete')).toMatchObject({ name: 'delete', effect: 'mutate', enabled: true });
  expect(byId.get('builtin:move')).toMatchObject({ name: 'move', effect: 'mutate', enabled: true });
  expect(byId.get('builtin:move')!.inputSchema.required).toEqual(['path', 'to']);
  const imageSchema = byId.get('builtin:generate-image')!.inputSchema as { required?: string[] };
  expect(imageSchema.required).toEqual(['prompt']);
});

test('chat does not refuse tools by effect; Settings and approval own enablement and consent', () => {
  const definitions = createBuiltinDefinitions();
  expect(blockedInChat(definitions.find((definition) => definition.id === 'builtin:memory-remember')!)).toBe(false);
  expect(blockedInChat(definitions.find((definition) => definition.id === 'builtin:run-code')!)).toBe(false);
  const externalWrite = { ...definitions.find((definition) => definition.id === 'builtin:edit')!, id: 'fixture-api:write_status', name: 'write_status', effect: 'mutate' as const };
  expect(blockedInChat(externalWrite)).toBe(false);
});

test('a conversation that names no tools is offered every enabled Settings tool', () => {
  const definitions = createBuiltinDefinitions();
  const offered = defaultChatToolIds(definitions);
  expect(offered).toContain('builtin:view');
  expect(offered).toContain('builtin:glob');
  expect(offered).toContain('builtin:grep');
  expect(offered).toContain('builtin:memory-search');
  expect(offered).toContain('builtin:memory-remember');
  expect(offered).not.toContain('builtin:run-code');
  expect(offered).toContain('builtin:web-search');
  expect(offered).not.toContain('builtin:run-command');
});

test('default chat tools keep one id when two connections share a tool name', () => {
  const definitions = createBuiltinDefinitions();
  const duplicate = { ...definitions.find((definition) => definition.id === 'builtin:web-search')!, id: 'fixture-mcp:web_search', connectionId: 'fixture-mcp', name: 'web_search' };
  const offered = defaultChatToolIds([...definitions, duplicate]);
  expect(offered.filter((id) => id.endsWith('web-search') || id.endsWith('web_search'))).toEqual(['builtin:web-search']);
});

test('glob and create accept common model field aliases before validation', () => {
  const byId = new Map(createBuiltinDefinitions().map((definition) => [definition.id, definition]));
  expect(invocationInput(byId.get('builtin:glob')!, { glob: '**/*.md' })).toEqual({ pattern: '**/*.md' });
  expect(invocationInput(byId.get('builtin:create')!, { path: 'programs/general/notes/a.md', contents: '# Hi' })).toEqual({
    path: 'programs/general/notes/a.md',
    file_text: '# Hi',
  });
});

test('the capability tool handlers receive validated input and preserve handler failures', async () => {
  const received: { value: Record<string, unknown> | null } = { value: null };
  const service = createToolsService(memoryStore(), {
    'builtin:memory-search': async (input) => { received.value = input; return { memories: [] }; },
    'builtin:memory-remember': async () => { throw new Error('Memory is turned off. Enable it in settings before storing facts.'); }
  });
  const invalid = await service.invoke('builtin:memory-search', { limit: 'x' });
  expect(invalid.status).toBe('failed');
  expect(invalid.error).toBe('Tool input does not match its declared fields.');
  expect(received.value).toBeNull();

  const succeeded = await service.invoke('builtin:memory-search', { query: 'air office', limit: 3 });
  expect(succeeded.status).toBe('succeeded');
  expect(received.value).toEqual({ query: 'air office', limit: 3 });

  const disabled = await service.invoke('builtin:run-code', { code: 'console.log(1)' });
  expect(disabled.status).toBe('failed');
  expect(disabled.error).toBe('This tool is not enabled.');

  const failed = await service.invoke('builtin:memory-remember', { content: 'fact' });
  expect(failed.status).toBe('failed');
  expect(failed.error).toBe('Memory is turned off. Enable it in settings before storing facts.');
});
