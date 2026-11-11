import { describe, expect, test } from 'bun:test';
import { createToolsService } from '../../../packages/tools/src/tools.service.public';
import { createBuiltinDefinitions } from '../../../packages/tools/src/tools.domain.public';
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

describe('tools service', () => {
  test('refreshes built-in definitions while preserving user enablement', () => {
    const store = memoryStore();
    const current = createBuiltinDefinitions().find((tool) => tool.id === 'builtin:apply-markdown-note')!;
    store.saveConnection({ id: 'builtin', name: 'AIR Office', kind: 'builtin', endpoint: null, discoveredAt: null, enabled: true });
    store.saveDefinition({ ...current, effect: 'read', enabled: false });
    const service = createToolsService(store, {});
    expect(service.definitions().find((tool) => tool.id === current.id)).toMatchObject({ effect: 'mutate', enabled: false });
  });

  test('rejects invalid inputs before calling the handler and preserves useful failures', async () => {
    let calls = 0;
    const service = createToolsService(memoryStore(), { 'builtin:view': async () => { calls += 1; throw new Error('File not found: missing.md'); } });
    const invalid = await service.invoke('builtin:view', {});
    expect(invalid.status).toBe('failed');
    expect(invalid.error).toBe('Tool input does not match its declared fields.');
    expect(calls).toBe(0);

    const failed = await service.invoke('builtin:view', { path: 'missing.md' });
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('File not found: missing.md');
    expect(calls).toBe(1);
  });

  test('coerces numeric strings for integer tool fields before validation', async () => {
    let received: Record<string, unknown> | null = null;
    const service = createToolsService(memoryStore(), {
      'builtin:memory-search': async (input) => {
        received = input;
        return { memories: [] };
      }
    });
    const result = await service.invoke('builtin:memory-search', { limit: '7' });
    expect(result.status).toBe('succeeded');
    expect(received!).toEqual({ limit: 7 });
  });

  test('rejects undeclared alias fields instead of remapping them', async () => {
    let received: Record<string, unknown> | null = null;
    const service = createToolsService(memoryStore(), {
      'builtin:memory-remember': async (input) => { received = input; return { memory: { id: 'm1' } }; },
      'builtin:view': async (input) => { received = input; return { content: 'x' }; },
    });

    expect((await service.invoke('builtin:memory-remember', { text: 'Prefer short answers', conversationId: 'c1' })).status).toBe('failed');
    expect(received).toBeNull();

    expect((await service.invoke('builtin:view', { noteId: 'note:x' })).status).toBe('failed');
    expect((await service.invoke('builtin:view', { path: 'programs/general/notes/a.md' })).status).toBe('succeeded');
    expect(received!).toEqual({ path: 'programs/general/notes/a.md' });
  });

  test('coerces JSON array strings for view_range before validation', async () => {
    let received: Record<string, unknown> | null = null;
    const service = createToolsService(memoryStore(), {
      'builtin:view': async (input) => {
        received = input;
        return { content: 'ok' };
      }
    });
    const result = await service.invoke('builtin:view', { path: 'a.md', view_range: '[1, 3]' });
    expect(result.status).toBe('succeeded');
    expect(received!).toEqual({ path: 'a.md', view_range: [1, 3] });
  });

  test('reports cancellation when a handler aborts its invocation', async () => {
    const service = createToolsService(memoryStore(), { 'builtin:view': async (_input, signal) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      throw new Error('Stopped.');
    } });
    const controller = new AbortController();
    const pending = service.invoke('builtin:view', { path: 'demo.md' }, controller.signal);
    controller.abort();
    expect((await pending).status).toBe('cancelled');
  });
});
