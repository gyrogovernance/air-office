export interface ConnectedRoot {
  id: string;
  name: string;
  path: string;
  connectedAt: string;
}

export interface FilesystemTarget { rootId: string; path: string }

export function externalFileId(target: FilesystemTarget): string { return `external:${encodeURIComponent(JSON.stringify([target.rootId, target.path]))}`; }

export function externalFileTarget(id: string): FilesystemTarget | null {
  if (!id.startsWith('external:')) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(id.slice(9)));
    return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string' ? { rootId: value[0], path: value[1] } : null;
  } catch { return null; }
}

export interface FilesystemEntry extends FilesystemTarget {
  name: string;
  kind: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modifiedAt: string;
}

export interface TrashedEntry {
  id: string;
  rootId: string;
  originalPath: string;
  deletedAt: string;
}

export type FilesystemExplorerErrorCode = 'invalid' | 'not-found' | 'conflict' | 'unauthorized' | 'unsupported' | 'too-large';

export class FilesystemExplorerError extends Error {
  constructor(readonly code: FilesystemExplorerErrorCode, message: string) { super(message); this.name = 'FilesystemExplorerError'; }
}
