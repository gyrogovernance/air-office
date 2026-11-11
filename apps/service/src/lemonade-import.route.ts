import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, sep } from 'node:path';
import { LemonadeManagementAdapter, type LemonadeRuntimeDescriptor } from '@office/providers/lemonade-status';

type Route = (request: Request, url: URL) => Promise<Response | null>;
export interface LemonadeImportOptions {
  /** Native app-data record path, supplied by the host rather than the renderer. */
  authorizationPath?: string;
  privateModelsDirectory?: string;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const denied = (message: string, status = 403) => Response.json({ error: { code: 'local-ai-import-denied', message } }, { status, headers: { 'Cache-Control': 'no-store' } });
function beneath(root: string, target: string) {
  const path = relative(root, target);
  return Boolean(path && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/** Wrap the existing management route so destructive calls cannot bypass ownership checks. Authentication remains at the application boundary. */
type DescriptorArg = LemonadeRuntimeDescriptor | null | (() => LemonadeRuntimeDescriptor | null);
const resolveDescriptor = (value: DescriptorArg) => typeof value === 'function' ? value() : value;

export function createLemonadeImportRoutes(getDescriptor: DescriptorArg, options: LemonadeImportOptions, next: Route): Route {
  return async (request, url) => {
    const descriptor = resolveDescriptor(getDescriptor);
    const storageRequest = url.pathname === '/api/v1/local-ai/import-folder' && ['GET', 'DELETE'].includes(request.method);
    if (storageRequest) {
      if (!descriptor) return denied('Local AI is unavailable.', 503);
      const adapter = new LemonadeManagementAdapter(descriptor);
      try {
        const config = await adapter.getConfig({ signal: request.signal });
        if (request.method === 'DELETE') { await adapter.setConfig({ key: 'extra_models_dir', value: '' }, { signal: request.signal }); return Response.json({ connected: false, filesPreserved: true }); }
        if (!object(config) || typeof config.extra_models_dir !== 'string' || !config.extra_models_dir) return Response.json({ connected: false });
        if (!options.authorizationPath) return Response.json({ connected: true, label: 'External model folder' });
        const authorization: unknown = JSON.parse(await readFile(options.authorizationPath, 'utf8'));
        const label = object(authorization) && authorization.path === config.extra_models_dir ? basename(config.extra_models_dir) : 'External model folder';
        return Response.json({ connected: true, label, deletionAllowed: false }, { headers: { 'Cache-Control': 'no-store' } });
      } catch { return denied('The external folder connection could not be refreshed. Its files are preserved.', 502); }
    }
    const importRequest = url.pathname === '/api/v1/local-ai/import-folder' && request.method === 'POST';
    const operationRequest = url.pathname === '/api/v1/local-ai/operations' && request.method === 'POST';
    if (!importRequest && !operationRequest) return next(request, url);
    const body: unknown = await request.clone().json().catch(() => null);
    if (!object(body)) return denied('Choose a valid local AI operation.', 400);
    if (!descriptor) return denied('The local AI runtime is unavailable.', 503);
    const adapter = new LemonadeManagementAdapter(descriptor);
    const callOptions = { signal: request.signal };
    try {
      if (importRequest) {
        if (!options.authorizationPath || typeof body.id !== 'string' || !/^[a-f0-9]{64}$/.test(body.id) || Object.keys(body).some((key) => key !== 'id')) return denied('Choose a folder using the desktop folder picker.');
        const recordFile = await stat(options.authorizationPath);
        if (!recordFile.isFile() || recordFile.size > 16_384) return denied('Choose the model folder again.');
        const record: unknown = JSON.parse(await readFile(options.authorizationPath, 'utf8'));
        if (!object(record) || record.id !== body.id || typeof record.path !== 'string' || !isAbsolute(record.path)) return denied('Choose the model folder again.');
        const folder = await realpath(record.path);
        if (folder !== record.path || !(await stat(folder)).isDirectory()) return denied('The selected folder changed. Choose it again.');
        await adapter.setConfig({ key: 'extra_models_dir', value: folder }, callOptions);
        return Response.json({ imported: true, ownership: 'external', deletionAllowed: false }, { headers: { 'Cache-Control': 'no-store' } });
      }
      // All storage changes go through the native selector. File paths stay service-side.
      if (body.operation === 'set-config' && object(body.input) && ['extra_models_dir', 'models_dir'].includes(String(body.input.key))) return denied('Change external model storage using the desktop folder picker.');
      if (body.operation === 'model-files' && body.includePaths === true) return denied('Absolute model paths are available only to the service.');
      if (body.operation === 'cleanup-cache') return denied('Cache cleanup is unavailable while shared-file ownership cannot be established.');
      if (body.operation === 'delete') {
        if (!options.privateModelsDirectory || !object(body.input) || typeof body.input.model_name !== 'string') return denied('Model deletion requires verified private storage.');
        const root = await realpath(options.privateModelsDirectory);
        const config = await adapter.getConfig(callOptions);
        if (!object(config) || typeof config.models_dir !== 'string' || config.models_dir === 'auto' || await realpath(config.models_dir) !== root) return denied('Shared model stores cannot be deleted through AIR Office.');
        const metadata = await adapter.getModelFiles(body.input.model_name, true, callOptions);
        if (!object(metadata) || !Array.isArray(metadata.files) || metadata.files.length === 0) return denied('File ownership could not be verified.');
        for (const file of metadata.files) {
          if (!object(file) || typeof file.path !== 'string' || !isAbsolute(file.path) || !beneath(root, await realpath(file.path))) return denied('External model files are preserved. Remove the folder reference to stop using them.');
        }
        // Use the inspected identity and consume the upstream response here, never exposing paths.
        await adapter.deleteModel({ model_name: body.input.model_name }, callOptions);
        return Response.json({ result: { deleted: true } }, { headers: { 'Cache-Control': 'no-store' } });
      }
      return next(request, url);
    } catch {
      return denied(importRequest ? 'The selected folder could not be imported. Choose it again or check runtime availability.' : 'File ownership could not be verified; the model files were preserved.', 400);
    }
  };
}
