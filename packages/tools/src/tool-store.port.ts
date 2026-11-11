import type { ToolConnection, ToolDefinition } from '@office/contracts/tool';

export interface ToolStore {
  connections(): ToolConnection[];
  saveConnection(connection: ToolConnection): void;
  definitions(connectionId?: string): ToolDefinition[];
  saveDefinition(definition: ToolDefinition): void;
  removeDefinition?(toolId: string): void;
  removeConnection?(connectionId: string): void;
  clearPersonalData(): void;
  close(): void;
}
