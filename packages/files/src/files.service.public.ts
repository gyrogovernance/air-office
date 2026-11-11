import { FileOperationError, type FileAdapter, type FileErrorCode, type FileSnapshot } from '@office/contracts/file';
import type { FilesystemExplorer } from './filesystem-explorer.service.public';
import { externalFileId, externalFileTarget, FilesystemExplorerError, type FilesystemExplorerErrorCode } from './filesystem-explorer.domain.public';

export interface FilesService {
  authorize: () => Promise<void>;
  restoreAuthorization: () => Promise<void>;
  list: () => Promise<FileSnapshot[]>;
  create: (name: string) => Promise<FileSnapshot>;
  read: (id: string) => Promise<FileSnapshot>;
  save: (id: string, content: string, expectedVersion: string) => Promise<FileSnapshot>;
}

/**
 * Direct reads and saves share the same version-guarded adapter used by the UI,
 * so authorization and expected-version checks stay on one path. Path mutate
 * tools (view/create/edit) live on the lean tool handlers, not this service.
 */
export function createFilesService(adapter: FileAdapter, connected?: Pick<FilesystemExplorer, 'read' | 'save'>): FilesService {
  const connectedErrors: Record<FilesystemExplorerErrorCode, FileErrorCode> = {
    invalid: 'file-invalid-name', 'not-found': 'file-not-found', conflict: 'file-stale-version', unauthorized: 'file-unauthorized', unsupported: 'file-unsupported-type', 'too-large': 'file-too-large'
  };
  const resolveConnected = async (id: string, operation: (target: NonNullable<ReturnType<typeof externalFileTarget>>, store: NonNullable<typeof connected>) => Promise<FileSnapshot>): Promise<FileSnapshot> => {
    const target = externalFileTarget(id);
    if (!target) throw new FileOperationError('file-invalid-name', 'The connected file identifier is invalid.');
    if (!connected) throw new FileOperationError('file-unauthorized', 'Connected folder access is unavailable.');
    try { return { ...await operation(target, connected), id: externalFileId(target) }; }
    catch (error) {
      if (error instanceof FilesystemExplorerError) throw new FileOperationError(connectedErrors[error.code], error.message);
      throw error;
    }
  };
  const read = (id: string): Promise<FileSnapshot> => id.startsWith('external:') ? resolveConnected(id, (target, store) => store.read(target)) : adapter.read(id);
  const save = (id: string, content: string, expectedVersion: string): Promise<FileSnapshot> => id.startsWith('external:')
    ? resolveConnected(id, (target, store) => store.save({ ...target, content, expectedVersion }))
    : adapter.save(id, content, expectedVersion);
  return {
    authorize: () => adapter.authorize(),
    restoreAuthorization: () => adapter.restoreAuthorization(),
    list: () => adapter.list(),
    create: (name: string) => adapter.create(name),
    read,
    save,
  };
}
