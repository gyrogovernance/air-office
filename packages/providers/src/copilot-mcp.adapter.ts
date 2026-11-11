import type { MCPServerConfig } from '@github/copilot-sdk';
import type { ProviderMcpServerConfig } from '@office/contracts/chat';

/** Maps AIR portable MCP handoffs into Copilot SDK server configs. */
export function toCopilotMcpServers(servers: Record<string, ProviderMcpServerConfig> | undefined): Record<string, MCPServerConfig> | undefined {
  if (!servers || !Object.keys(servers).length) return undefined;
  const mapped: Record<string, MCPServerConfig> = {};
  for (const [name, server] of Object.entries(servers)) {
    if (server.type === 'stdio') {
      mapped[name] = {
        type: 'stdio',
        command: server.command,
        ...(server.args ? { args: server.args } : {}),
        ...(server.env ? { env: server.env } : {}),
        ...(server.workingDirectory ? { workingDirectory: server.workingDirectory } : {}),
        ...(server.tools ? { tools: server.tools } : {})
      };
      continue;
    }
    mapped[name] = {
      type: server.type,
      url: server.url,
      ...(server.headers ? { headers: server.headers } : {}),
      ...(server.tools ? { tools: server.tools } : {})
    };
  }
  return mapped;
}
