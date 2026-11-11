import type { ConnectedRoot, FilesystemTarget } from '@office/files/domain';

/** Copilot first-party tools that operate on a connected-folder file path. */
const FILE_TOOL_NAMES = new Set([
  'create',
  'write',
  'edit',
  'view',
  'delete',
  'move',
  'open_path',
  'open_in_code',
  'apply_patch',
]);

/** Tools that create or change a file; successful ones belong in the reply footer, not mid-stream cards. */
const FILE_MUTATION_TOOL_NAMES = new Set([
  'create',
  'write',
  'edit',
  'delete',
  'move',
  'apply_patch',
  'write_file',
  'create_file',
]);

const PATH_KEYS = ['path', 'filePath', 'file_path', 'fileName', 'target'] as const;

export type WorkspaceFileTouch = {
  path: string;
};

export function isFileMutationTool(toolName: string): boolean {
  return FILE_MUTATION_TOOL_NAMES.has(toolName);
}

/**
 * Successful create/edit/write tools, in call order, with duplicate paths kept once.
 * Used for the quiet file-pill footer after the assistant reply. The footer does
 * not claim create versus edit; only the path is known for certain.
 */
export function workspaceFileTouches(tools: readonly {
  name?: string;
  arguments?: unknown;
  result?: unknown;
  status?: string;
  isError?: boolean;
}[]): WorkspaceFileTouch[] {
  const seen = new Set<string>();
  const touches: WorkspaceFileTouch[] = [];
  for (const tool of tools) {
    if (!tool.name || !isFileMutationTool(tool.name)) continue;
    if (tool.isError || tool.status === 'error' || tool.status === 'running' || tool.status === 'pending') continue;
    if (tool.status !== undefined && tool.status !== 'ok') continue;
    const path = toolWorkspacePath(tool.name, tool.arguments, tool.result);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    touches.push({ path });
  }
  return touches;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch { return null; }
  }
  return null;
}

function pathLike(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512 || trimmed.includes('\0') || /\n|\r/.test(trimmed)) return false;
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\') || trimmed.startsWith('/')) return true;
  const segments = trimmed.split(/[\\/]/);
  return segments.length > 1 && segments.every((segment) => /^[\w.-]+$/.test(segment));
}

function firstPath(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  for (const key of PATH_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && pathLike(value)) return value.trim();
  }
  return null;
}

/** Absolute or workspace-relative path a file tool carried in its args or result. */
export function toolWorkspacePath(toolName: string, args: unknown, result: unknown): string | null {
  if (!FILE_TOOL_NAMES.has(toolName)) return null;
  return firstPath(asRecord(args)) ?? firstPath(asRecord(result));
}

function normalizeSeparators(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '');
}

/**
 * Maps a tool path onto a connected folder. Absolute paths must sit under a
 * connected root; relative paths resolve against each root until one fits the
 * longest matching root prefix.
 */
export function connectedFileTarget(path: string, roots: readonly ConnectedRoot[]): FilesystemTarget | null {
  const trimmed = path.trim();
  if (!trimmed || trimmed.includes('\0')) return null;
  const absolute = /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\\\');
  const pathNorm = normalizeSeparators(trimmed);
  const pathKey = pathNorm.toLowerCase();

  if (absolute) {
    const match = [...roots]
      .map((root) => ({ root, key: normalizeSeparators(root.path).toLowerCase(), length: normalizeSeparators(root.path).length }))
      .filter(({ key }) => pathKey === key || pathKey.startsWith(`${key}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (!match) return null;
    const relative = pathNorm.slice(match.length).replace(/^\//, '');
    return relative ? { rootId: match.root.id, path: relative } : null;
  }

  const relative = pathNorm.replace(/^\.\//, '');
  if (!relative || relative.split('/').some((part) => part === '..' || part === '')) return null;
  // Relative tool paths need a single connected folder; otherwise the open target is ambiguous.
  return roots.length === 1 ? { rootId: roots[0]!.id, path: relative } : null;
}

/** Vault-relative workspace path (not an absolute OS path). */
export function isVaultRelativeWorkspacePath(path: string): boolean {
  const trimmed = path.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed.includes('\0')) return false;
  if (/^[A-Za-z]:\//.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('//')) return false;
  const relative = trimmed.replace(/^\.\//, '');
  if (!relative || relative.split('/').some((part) => part === '' || part === '..')) return false;
  return /^[\w.-]+(?:\/[\w.-]+)+$/.test(relative) || /^[\w.-]+\.(md|note\.json|txt|json|yaml|yml|ics|csv)$/i.test(relative);
}

export function isVaultNotePath(path: string): boolean {
  const normalized = path.trim().replace(/\\/g, '/');
  return /(?:^|\/)notes\//.test(normalized) && (/\.md$/i.test(normalized) || /\.note\.json$/i.test(normalized));
}

export type WorkspaceOpenTarget =
  | { kind: 'connected'; target: FilesystemTarget }
  | { kind: 'vault-note'; path: string }
  | { kind: 'vault-file'; path: string };

/** Resolve a chat/tool path to a stage open target (connected folder or vault). */
export function resolveWorkspaceOpenTarget(path: string, roots: readonly ConnectedRoot[]): WorkspaceOpenTarget | null {
  const connected = connectedFileTarget(path, roots);
  if (connected) return { kind: 'connected', target: connected };
  if (!isVaultRelativeWorkspacePath(path)) return null;
  const relative = path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (isVaultNotePath(relative)) return { kind: 'vault-note', path: relative };
  return { kind: 'vault-file', path: relative };
}

/** Turns absolute filesystem paths in assistant prose into stage-open markdown links. */
export function linkifyWorkspacePaths(text: string): string {
  return text.replace(
    /(^|[\s(])((?:[A-Za-z]:\\|\\\\)[^\s`"'<>|*?]+)/g,
    (full, prefix: string, rawPath: string) => {
      const match = rawPath.match(/^(.*?)([.,;:!?)]*)$/);
      const path = match?.[1] ?? rawPath;
      const trailing = match?.[2] ?? '';
      if (!pathLike(path)) return full;
      const name = path.split(/[/\\]/).pop() || path;
      return `${prefix}[${name}](air-file:${encodeURIComponent(path)})${trailing}`;
    }
  );
}

export function airFilePath(href: string | null | undefined): string | null {
  if (!href?.startsWith('air-file:')) return null;
  try { return decodeURIComponent(href.slice('air-file:'.length)); }
  catch { return null; }
}

/** Basename for link text; full path stays on the title attribute. */
export function workspaceFileLabel(path: string): string {
  const trimmed = path.trim();
  return trimmed.split(/[/\\]/).pop() || trimmed;
}
