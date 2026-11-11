declare global {
  interface FileSystemHandle {
    readonly kind: 'file' | 'directory';
    readonly name: string;
    isSameEntry(other: FileSystemHandle): Promise<boolean>;
  }
  interface FileSystemFileHandle extends FileSystemHandle {
    getFile(): Promise<File>;
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  }
  interface FileSystemDirectoryHandle extends FileSystemHandle {
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
    queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
    requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  }
  interface StorageManager {
    getDirectory(): Promise<FileSystemDirectoryHandle>;
  }
  interface Window {
    __AIR_SERVICE_BASE__?: string;
    __AIR_LEMONADE_STATUS__?: { kind: string; generation: number | null; base_origin: string | null; release: string; state: string };
    airDesktop?: unknown;
    showDirectoryPicker?: (options?: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }
}

const defaultServiceBase = 'http://127.0.0.1:4317';
let serviceBasePromise: Promise<string> | null = null;

async function resolveServiceBase(): Promise<string> {
  if (typeof window !== 'undefined' && window.__AIR_SERVICE_BASE__) return window.__AIR_SERVICE_BASE__;
  serviceBasePromise ??= (async () => {
    // nosemgrep: typescript.react.security.react-insecure-request -- loopback-only bootstrap; the service validates Origin before issuing a token.
    const response = await fetch(`${defaultServiceBase}/bootstrap`, { method: 'POST', mode: 'cors', cache: 'no-store' });
    if (!response.ok) throw new Error('The local service did not authorize this session.');
    const body = await response.json() as { serviceBase?: unknown };
    const base = typeof body.serviceBase === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(body.serviceBase) ? body.serviceBase : defaultServiceBase;
    if (typeof window !== 'undefined') window.__AIR_SERVICE_BASE__ = base;
    return base;
  })().catch((error: unknown) => { serviceBasePromise = null; throw error; });
  return serviceBasePromise;
}

export async function bootstrapToken(port?: number): Promise<string> {
  const base = port ? `http://127.0.0.1:${port}` : await resolveServiceBase();
  const response = await fetch(`${base}/bootstrap`, { method: 'POST', mode: 'cors', cache: 'no-store' });
  if (!response.ok) throw new Error('The local service did not authorize this session.');
  const body = await response.json() as { token: string };
  return body.token;
}
