import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderMcpServerConfig } from '@office/contracts/chat';
import type { ToolConnection, ToolDefinition } from '@office/contracts/tool';
import { LOCAL_MCP_CATALOG } from '@office/tools/service';

function canonicalizeRoot(root: string): string | null {
  try { return realpathSync(root); } catch { return null; }
}

/** Stable MCP server key used in Copilot mcpServers and auth callbacks. */
export function mcpServerKey(connectionId: string): string {
  return connectionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'mcp';
}

export function mcpEndpointsMatch(stored: string | null | undefined, reported: string): boolean {
  if (!stored) return false;
  try {
    return new URL(stored).href === new URL(reported).href;
  } catch {
    return stored === reported;
  }
}

/** Canonical trusted roots for a Copilot run, preferred folder first when valid. */
export function resolveCopilotWorkspaceRoots(options: {
  connectedRoots: readonly string[];
  /** @deprecated Legacy private/files root is no longer auto-trusted; vault + connected roots only. */
  filesRoot?: string;
  preferredWorkspaceRoot?: string | null;
  fallbackWorkdir: string;
}): { workspaceRoots: string[]; workingDirectory: string } {
  const roots: string[] = [];
  const seen = new Set<string>();
  // Vault workdir first so chat tools and relative paths stay under the office vault.
  // Do not auto-trust legacy private/files; connected mounts are explicit trusted roots.
  for (const root of [options.fallbackWorkdir, ...options.connectedRoots]) {
    const canonical = canonicalizeRoot(root);
    if (!canonical || seen.has(canonical)) continue;
    // Keep connected roots even when the stored path and realpath differ (Windows junctions).
    seen.add(canonical);
    roots.push(canonical);
  }
  const preferred = typeof options.preferredWorkspaceRoot === 'string' ? options.preferredWorkspaceRoot.trim() : '';
  const preferredCanonical = preferred ? canonicalizeRoot(preferred) : null;
  const ordered = preferredCanonical && seen.has(preferredCanonical)
    ? [preferredCanonical, ...roots.filter((root) => root !== preferredCanonical)]
    : roots;
  const workingDirectory = ordered[0] ?? options.fallbackWorkdir;
  return { workspaceRoots: ordered, workingDirectory };
}

/** Builds Copilot-hosted MCP configs for selected tools; OpenAPI stays on AIR custom tools. */
export function buildCopilotMcpServers(options: {
  selectedTools: readonly ToolDefinition[];
  connections: readonly ToolConnection[];
  localInstallRoot: string;
  nodeExecutable?: string | null;
  accessToken: (connectionId: string) => Promise<string | null>;
}): Promise<{ servers: Record<string, ProviderMcpServerConfig>; hostedConnectionIds: Set<string> }> {
  return buildCopilotMcpServersAsync(options);
}

async function buildCopilotMcpServersAsync(options: {
  selectedTools: readonly ToolDefinition[];
  connections: readonly ToolConnection[];
  localInstallRoot: string;
  nodeExecutable?: string | null;
  accessToken: (connectionId: string) => Promise<string | null>;
}): Promise<{ servers: Record<string, ProviderMcpServerConfig>; hostedConnectionIds: Set<string> }> {
  const selectedByConnection = new Map<string, string[]>();
  for (const tool of options.selectedTools) {
    if (tool.connectionId === 'builtin') continue;
    const connection = options.connections.find((item) => item.id === tool.connectionId);
    if (!connection || connection.kind !== 'mcp' || !connection.enabled) continue;
    const original = tool.id.includes(':') ? tool.id.slice(tool.id.indexOf(':') + 1) : tool.name;
    const list = selectedByConnection.get(connection.id) ?? [];
    list.push(original);
    selectedByConnection.set(connection.id, list);
  }
  const servers: Record<string, ProviderMcpServerConfig> = {};
  const hostedConnectionIds = new Set<string>();
  for (const [connectionId, toolNames] of selectedByConnection) {
    const connection = options.connections.find((item) => item.id === connectionId);
    if (!connection) continue;
    const key = mcpServerKey(connectionId);
    if (connection.local) {
      const descriptor = LOCAL_MCP_CATALOG[connection.local.catalogId];
      const node = options.nodeExecutable ?? Bun.which('node');
      if (!node || !existsSync(node)) continue;
      const entry = join(options.localInstallRoot, connection.local.catalogId, 'node_modules', descriptor.packageName, descriptor.entrypoint);
      if (!existsSync(entry)) continue;
      const env: Record<string, string> = {};
      if (descriptor.credentialEnvironment) {
        const token = await options.accessToken(connectionId);
        if (!token) continue;
        env[descriptor.credentialEnvironment] = token;
      }
      servers[key] = { type: 'stdio', command: node, args: [entry], ...(Object.keys(env).length ? { env } : {}), tools: toolNames };
      hostedConnectionIds.add(connectionId);
      continue;
    }
    if (!connection.endpoint) continue;
    let url: URL;
    try { url = new URL(connection.endpoint); } catch { continue; }
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || url.username || url.password || url.hash) continue;
    servers[key] = { type: 'http', url: url.href, tools: toolNames };
    hostedConnectionIds.add(connectionId);
  }
  return { servers, hostedConnectionIds };
}
