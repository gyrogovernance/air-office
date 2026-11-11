import type { ToolConnection, ToolDefinition } from '@office/contracts/tool';
import type { ToolHandler, ToolsService } from '@office/tools/service';
import type { LemonadeRuntimeDescriptor } from '@office/providers/service';

export const LEMONADE_TOOL_CONNECTION_ID = 'air-local-tools';

/** Refresh the ephemeral endpoint while retaining the user's existing enabled state. */
export function registerLemonadeToolConnection(tools: ToolsService, descriptor: LemonadeRuntimeDescriptor | null): void {
  const previous = tools.connections().find((entry) => entry.id === LEMONADE_TOOL_CONNECTION_ID);
  if (!descriptor) {
    if (previous) tools.saveConnection({ ...previous, enabled: false, endpoint: null });
    return;
  }
  tools.saveConnection({ id: LEMONADE_TOOL_CONNECTION_ID, name: 'Local AI inference tools', kind: 'mcp', endpoint: new URL('/mcp', descriptor.baseOrigin).href, enabled: previous?.enabled ?? false, discoveredAt: null });
}

/** Runtime downloads and disk outputs remain explicit model/storage operations in AIR. */
export function constrainLemonadeTools(connection: ToolConnection, operations: { definition: ToolDefinition; handler: ToolHandler }[], inference?: LemonadeRuntimeDescriptor['inference']): { definition: ToolDefinition; handler: ToolHandler }[] {
  if (connection.id !== LEMONADE_TOOL_CONNECTION_ID) return operations;
  return operations.map(({ definition, handler }) => {
    const properties = { ...definition.inputSchema.properties };
    delete properties.allow_download;
    delete properties.output_path;
    delete properties.output_dir;
    const inputSchema = { ...definition.inputSchema, properties, required: definition.inputSchema.required?.filter((key) => !['allow_download', 'output_path', 'output_dir'].includes(key)) };
    return {
      definition: { ...definition, inputSchema, effect: definition.name === 'lemonade_list_models' ? 'read' as const : 'mutate' as const },
      handler: async (input, signal) => {
        if (input.allow_download === true || input.output_path !== undefined || input.output_dir !== undefined) throw new Error('Manage model downloads and saved files through Local AI settings.');
        const gate = definition.name === 'lemonade_list_models' ? undefined : inference?.signal(typeof input.model === 'string' ? input.model : typeof input.model_name === 'string' ? input.model_name : undefined);
        return handler({ ...input, allow_download: false }, gate ? AbortSignal.any([signal, gate]) : signal);
      }
    };
  });
}
