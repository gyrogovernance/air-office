export interface FileSnapshot {
  id: string;
  name: string;
  content: string;
  version: string;
}

export interface FileAdapter {
  authorize(): Promise<void>;
  restoreAuthorization(): Promise<void>;
  list(): Promise<FileSnapshot[]>;
  create(name: string): Promise<FileSnapshot>;
  read(id: string): Promise<FileSnapshot>;
  save(id: string, content: string, expectedVersion: string): Promise<FileSnapshot>;
}

/**
 * Typed file-operation failures. A stale write must be distinguishable from a
 * missing file, an authorization rejection, or a size-limit rejection so callers
 * (routes, tool invocation, UI) can react without string matching.
 */
export type FileErrorCode =
  | 'file-unauthorized'
  | 'file-not-found'
  | 'file-stale-version'
  | 'file-too-large'
  | 'file-unsupported-type'
  | 'file-invalid-name';

export class FileOperationError extends Error {
  readonly code: FileErrorCode;

  constructor(code: FileErrorCode, message: string) {
    super(message);
    this.name = 'FileOperationError';
    this.code = code;
  }
}

/** Canonical HTTP status for each file-operation failure code. */
export const fileErrorStatus: Record<FileErrorCode, number> = {
  'file-unauthorized': 403,
  'file-not-found': 404,
  'file-stale-version': 409,
  'file-too-large': 413,
  'file-unsupported-type': 415,
  'file-invalid-name': 400
};
