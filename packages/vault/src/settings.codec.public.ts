import { atomicWriteText } from './atomic-write.adapter';

export type WorkspaceSettings = {
  schema: 'air.workspace/1';
  mounts: { id: string; rootId: string; label: string; parentId?: string | null }[];
  sortProgramIds?: string[];
};

export type ToolsSettings = {
  schema: 'air.tools/1';
  connections: {
    id: string;
    name: string;
    kind: 'builtin' | 'openapi' | 'mcp';
    endpoint: string | null;
    enabled: boolean;
    local?: { catalogId: 'atomic-mail' | 'resend' | 'shopify-dev' };
  }[];
  definitions: {
    id: string;
    connectionId: string;
    name: string;
    enabled: boolean;
  }[];
};

export type WebSearchSettings = {
  schema: 'air.web-search/1';
  enabled: boolean;
  endpoint: string | null;
  options: Record<string, unknown>;
};

export type ModelHarnessSettings = {
  schema: 'air.model-harness/1';
  fullHarness: { providerId: string; modelId: string; enabled: boolean }[];
};

function parseYamlMapping(bytes: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(bytes);
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid ${label}: expected a YAML mapping.`);
  }
  return parsed as Record<string, unknown>;
}

export function parseWorkspaceSettings(bytes: string): WorkspaceSettings {
  const data = parseYamlMapping(bytes, 'workspace.yaml');
  if (data.schema !== 'air.workspace/1') throw new Error('workspace.yaml schema must be air.workspace/1.');
  if (!Array.isArray(data.mounts)) throw new Error('workspace.yaml mounts must be an array.');
  for (const mount of data.mounts) {
    if (!mount || typeof mount !== 'object' || Array.isArray(mount)) throw new Error('Invalid workspace mount.');
    const record = mount as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.rootId !== 'string' || typeof record.label !== 'string') throw new Error('Invalid workspace mount fields.');
    if (record.parentId !== undefined && record.parentId !== null && typeof record.parentId !== 'string') {
      throw new Error('Invalid workspace mount parentId.');
    }
    for (const key of Object.keys(record)) {
      if (key !== 'id' && key !== 'rootId' && key !== 'label' && key !== 'parentId') throw new Error(`Unknown workspace mount key: ${key}`);
    }
  }
  if (data.sortProgramIds !== undefined && (!Array.isArray(data.sortProgramIds) || data.sortProgramIds.some((id) => typeof id !== 'string'))) {
    throw new Error('workspace.yaml sortProgramIds must be a string array.');
  }
  for (const key of Object.keys(data)) {
    if (key !== 'schema' && key !== 'mounts' && key !== 'sortProgramIds') throw new Error(`Unknown workspace.yaml key: ${key}`);
  }
  return data as WorkspaceSettings;
}

/** Codec for vault `.air/settings/tools.yaml` (portable enablement authority). */
export function parseToolsSettings(bytes: string): ToolsSettings {
  const data = parseYamlMapping(bytes, 'tools.yaml');
  if (data.schema !== 'air.tools/1') throw new Error('tools.yaml schema must be air.tools/1.');
  return data as ToolsSettings;
}

/** Codec for vault `.air/settings/web-search.yaml`. */
export function parseWebSearchSettings(bytes: string): WebSearchSettings {
  const data = parseYamlMapping(bytes, 'web-search.yaml');
  if (data.schema !== 'air.web-search/1') throw new Error('web-search.yaml schema must be air.web-search/1.');
  return data as WebSearchSettings;
}

/** Codec for vault `.air/settings/model-harness.yaml`. */
export function parseModelHarnessSettings(bytes: string): ModelHarnessSettings {
  const data = parseYamlMapping(bytes, 'model-harness.yaml');
  if (data.schema !== 'air.model-harness/1') throw new Error('model-harness.yaml schema must be air.model-harness/1.');
  return data as ModelHarnessSettings;
}

export function writeYamlSettings(absolutePath: string, value: object): void {
  atomicWriteText(absolutePath, Bun.YAML.stringify(value));
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  schema: 'air.workspace/1',
  mounts: [],
};
