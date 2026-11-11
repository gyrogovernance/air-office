import type { ToolConnection, ToolDefinition } from '@office/contracts/tool';
import { invocationInput, validateConnection, validateDefinition } from './tools.domain.public';
import type { ToolHandler, ToolInvocation } from './tools.domain.public';
import { createBuiltinDefinitions } from './tools.domain.public';
import type { ToolStore } from './tool-store.port';

export type { ToolHandler, ToolInvocation } from './tools.domain.public';
export type { ToolStore } from './tool-store.port';
export { blockedInChat, defaultChatToolIds, selectEnabledTools } from './tools.domain.public';
export { createSqliteToolStore } from './tool-store.adapter';
export { createVaultBackedToolStore } from './tool-store-vault.adapter';
export { createRemoteToolConnector } from './remote-tool-connector.adapter';
export { createLocalToolConnector, LOCAL_MCP_CATALOG } from './local-tool-connector.adapter';
export type { LocalMcpOptions } from './local-tool-connector.adapter';
export { createCodeInterpreter } from './code-interpreter.adapter';
export type { CodeExecutionRequest, CodeExecutionResult, CodeInterpreter, CodeInterpreterOptions } from './code-interpreter.adapter';
export { createCommandRunner, resolveCommandProgram, commandAvailable, CommandPolicyError } from './command-runner.adapter';
export type { CommandProgram, CommandRunner, CommandRunnerOptions, CommandExecutionRequest, CommandExecutionResult } from './command-runner.adapter';
export { createHttpRequestClient, HttpRequestPolicyError } from './http-request.adapter';
export { createWebFetchClient } from './web-fetch.adapter';
export type { WebFetchClient, WebFetchInput, WebFetchResult } from './web-fetch.adapter';
export { mergeTodos, type TodoItem, type TodoStatus } from './todo-write.policy';
export { listCalendarEvents, type CalendarListHit, type CalendarListEventInput } from './calendar-list.policy';
export {
  leanView,
  leanCreate,
  leanEdit,
  leanDelete,
  leanMove,
  leanPathKind,
  leanGlob,
  leanGrep,
  resolveLeanPath,
  type LeanPathRoots,
} from './lean-file-tools.adapter';
export type { HttpRequestClient, HttpRequestInput, HttpRequestOptions, HttpResponse } from './http-request.adapter';

export type ToolsService = ReturnType<typeof createToolsService>;

export function createToolsService(store: ToolStore, handlers: Record<string, ToolHandler>) {
  const existingBuiltins = store.definitions('builtin');
  const current = createBuiltinDefinitions();
  const currentIds = new Set(current.map((definition) => definition.id));
  for (const definition of current) {
    const existing = existingBuiltins.find((item) => item.id === definition.id);
    store.saveDefinition(existing ? { ...definition, enabled: existing.enabled } : definition);
  }
  for (const obsolete of existingBuiltins) {
    if (currentIds.has(obsolete.id)) continue;
    store.removeDefinition?.(obsolete.id);
    delete handlers[obsolete.id];
  }
  if (!store.connections().some((connection) => connection.id === 'builtin')) store.saveConnection({ id: 'builtin', name: 'AIR Office', kind: 'builtin', endpoint: null, discoveredAt: null, enabled: true });
  return {
    connections: (): ToolConnection[] => store.connections(),
    saveConnection: (connection: ToolConnection): void => { if (!validateConnection(connection)) throw new Error('Invalid tool connection.'); store.saveConnection(connection); },
    definitions: (enabledOnly = false): ToolDefinition[] => store.definitions().filter((tool) => !enabledOnly || tool.enabled && store.connections().some((connection) => connection.id === tool.connectionId && connection.enabled)),
    saveDefinition: (definition: ToolDefinition): void => { if (!validateDefinition(definition)) throw new Error('Invalid tool definition.'); if (!store.connections().some((connection) => connection.id === definition.connectionId)) throw new Error('Unknown tool connection.'); store.saveDefinition(definition); },
    removeConnection: (connectionId: string): void => {
      if (connectionId === 'builtin') throw new Error('Built-in tools cannot be removed.');
      if (!store.removeConnection) throw new Error('Connection removal is unavailable in this storage adapter.');
      for (const definition of store.definitions(connectionId)) delete handlers[definition.id];
      store.removeConnection(connectionId);
    },
    setHandler: (toolId: string, handler: ToolHandler): void => { handlers[toolId] = handler; },
    async invoke(toolId: string, rawInput: unknown, signal = new AbortController().signal, scopedHandler?: ToolHandler): Promise<ToolInvocation> {
      const definition = store.definitions().find((tool) => tool.id === toolId);
      const connection = definition && store.connections().find((entry) => entry.id === definition.connectionId);
      const invocation: ToolInvocation = { id: crypto.randomUUID(), toolId, status: 'running', startedAt: new Date().toISOString(), finishedAt: null, result: null, error: null };
      try {
        if (!definition || !definition.enabled || !connection?.enabled) throw new Error('This tool is not enabled.');
        const handler = scopedHandler ?? handlers[toolId];
        if (!handler) throw new Error('This tool has no available executor.');
        const result = await handler(invocationInput(definition, rawInput), signal);
        if (signal.aborted) invocation.status = 'cancelled';
        else { invocation.status = 'succeeded'; invocation.result = result; }
      } catch (error) {
        invocation.status = signal.aborted ? 'cancelled' : 'failed';
        invocation.error = signal.aborted ? 'The operation was cancelled.' : error instanceof Error ? error.message : 'The tool operation failed.';
      }
      invocation.finishedAt = new Date().toISOString();
      return invocation;
    }
  };
}
