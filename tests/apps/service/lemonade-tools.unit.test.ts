import { expect, test } from 'bun:test';
import type { ToolConnection, ToolDefinition } from '@office/contracts/tool';
import { createToolsService } from '@office/tools/service';
import { constrainLemonadeTools, registerLemonadeToolConnection, LEMONADE_TOOL_CONNECTION_ID } from '../../../apps/service/src/lemonade-tools.adapter';

const descriptor = { instanceId: 'fixture', generation: 2, release: '2026.42.1', baseOrigin: 'http://127.0.0.1:13305', resolveSecret: () => 'private-key' };
test('runtime MCP registration preserves opt-in and refreshes endpoint without saving its secret', () => {
  const connections = new Map<string, ToolConnection>();
  const definitions = new Map<string, ToolDefinition>();
  const tools = createToolsService({ connections: () => [...connections.values()], definitions: () => [...definitions.values()], saveConnection: (value) => { connections.set(value.id, value); }, saveDefinition: (value) => { definitions.set(value.id, value); }, clearPersonalData() {}, close() {} }, {});
  registerLemonadeToolConnection(tools, descriptor);
  const connection = connections.get(LEMONADE_TOOL_CONNECTION_ID)!;
  expect(connection).toMatchObject({ enabled: false, endpoint: 'http://127.0.0.1:13305/mcp' });
  tools.saveConnection({ ...connection, enabled: true });
  registerLemonadeToolConnection(tools, { ...descriptor, generation: 3, baseOrigin: 'http://127.0.0.1:14000' });
  expect(connections.get(connection.id)).toMatchObject({ enabled: true, endpoint: 'http://127.0.0.1:14000/mcp' });
  expect(JSON.stringify([...connections.values()])).not.toContain('private-key');
  registerLemonadeToolConnection(tools, null);
  expect(connections.get(connection.id)).toMatchObject({ enabled: false, endpoint: null });
});

test('runtime tool calls cannot download weights or write disk outputs through inference consent', async () => {
  let received: Record<string, unknown> | undefined;
  const connection: ToolConnection = { id: LEMONADE_TOOL_CONNECTION_ID, name: 'Local AI', kind: 'mcp', endpoint: 'http://127.0.0.1:13305/mcp', enabled: true, discoveredAt: null };
  const definition: ToolDefinition = { id: `${connection.id}:lemonade_chat`, connectionId: connection.id, name: 'lemonade_chat', description: 'Chat', effect: 'read', enabled: false, inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, allow_download: { type: 'boolean' }, output_path: { type: 'string' } } } };
  const constrained = constrainLemonadeTools(connection, [{ definition, handler: async (input) => { received = input; return { ok: true }; } }])[0]!;
  expect(constrained.definition.effect).toBe('mutate');
  expect(constrained.definition.inputSchema.properties).not.toHaveProperty('allow_download');
  expect(constrained.definition.inputSchema.properties).not.toHaveProperty('output_path');
  await constrained.handler({ prompt: 'hello' }, new AbortController().signal);
  expect(received).toEqual({ prompt: 'hello', allow_download: false });
  await expect(constrained.handler({ allow_download: true }, new AbortController().signal)).rejects.toThrow('Manage model downloads');
  await expect(constrained.handler({ output_path: 'x.png' }, new AbortController().signal)).rejects.toThrow('Manage model downloads');
});
