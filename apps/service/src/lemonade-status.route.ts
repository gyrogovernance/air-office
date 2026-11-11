import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { LemonadeManagementAdapter, LemonadeStatusError, runLemonadeOperation, validateOwnedModelRegistration, ownedModelRegistrationPath, type LemonadeOperation, type LemonadeRequestOptions, type LemonadeRuntimeDescriptor } from '@office/providers/lemonade-status';
import { getLemonadeRuntimeStatus } from '@office/providers/lemonade-status';

const safeStatuses: Record<LemonadeStatusError['code'], number> = { timeout: 504, cancelled: 499, upstream: 502, protocol: 502, unavailable: 503, 'invalid-request': 400 };
const operationNames = new Set(['system-info','health','stats','system-stats','catalog-models','installed-models','downloads','check-updates','jobs','slots','config','config-defaults','aliases','sync-models','sync-status','cleanup-cache','registry-search','variants','model-files','pull','install','install-dry-run','uninstall','download-control','load','unload','delete','model-options','save-model-options','reset-model-options','register-model','validate-routing','job','create-job','job-control','delete-job','slot-control','tokenize','classify','set-config','pin','add-alias','remove-alias']);
function isLemonadeOperation(value: unknown): value is LemonadeOperation {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { operation?: unknown }).operation === 'string' && operationNames.has((value as { operation: string }).operation));
}

function canonicalModelDirectory(modelsDirectory: string, name: string): string {
  const root = realpathSync(modelsDirectory);
  const target = realpathSync(ownedModelRegistrationPath(name, root));
  const relativeTarget = relative(root, target);
  if (!relativeTarget || relativeTarget === '.' || relativeTarget.startsWith(`..${sep}`) || relativeTarget === '..' || isAbsolute(relativeTarget)) throw new LemonadeStatusError('invalid-request');
  if (!statSync(target).isDirectory()) throw new LemonadeStatusError('invalid-request');
  return target;
}

type DescriptorArg = LemonadeRuntimeDescriptor | null | (() => LemonadeRuntimeDescriptor | null);
const resolveDescriptor = (value: DescriptorArg) => typeof value === 'function' ? value() : value;

export function createLemonadeStatusRoutes(getDescriptor: DescriptorArg) {
  return async (request: Request, url: URL): Promise<Response | null> => {
    const descriptor = resolveDescriptor(getDescriptor);
    if (url.pathname === '/api/v1/local-ai/docs' && request.method === 'GET') {
      if (!descriptor) return Response.json({ error: { code: 'local-ai-unavailable', message: 'The local AI runtime is not configured.' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      const docsUrl = new URL('/v1/docs', descriptor.baseOrigin);
      try {
        const headers = new Headers({ Accept: 'text/html' });
        const secret = await descriptor.resolveSecret();
        if (secret) headers.set('Authorization', `Bearer ${secret}`);
        const upstream = await fetch(docsUrl, { headers, signal: request.signal, redirect: 'error' });
        if (!upstream.ok) return Response.json({ error: { code: 'local-ai-docs-unavailable', message: 'Runtime API documentation is unavailable.' } }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
        const contentType = upstream.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('text/html')) return Response.json({ error: { code: 'local-ai-docs-protocol', message: 'The runtime did not return an HTML documentation page.' } }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
        const page = await upstream.text();
        if (page.length > 2 * 1024 * 1024) return Response.json({ error: { code: 'local-ai-docs-too-large', message: 'Runtime API documentation exceeded the response limit.' } }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
        return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", 'X-Content-Type-Options': 'nosniff' } });
      } catch {
        return Response.json({ error: { code: 'local-ai-docs-unavailable', message: 'Runtime API documentation is unavailable.' } }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
      }
    }
    if (url.pathname === '/api/v1/local-ai/status' && request.method === 'GET') {
      if (!descriptor) return Response.json({ error: { code: 'local-ai-unavailable', message: 'The local AI runtime is not configured.' } }, { status: 503 });
      try { return Response.json(await getLemonadeRuntimeStatus(descriptor, { signal: request.signal }), { headers: { 'Cache-Control': 'no-store' } }); }
      catch (error) { const status = error instanceof LemonadeStatusError && error.code === 'invalid-request' ? 503 : error instanceof LemonadeStatusError ? safeStatuses[error.code] : 503; const code = error instanceof LemonadeStatusError && error.code === 'invalid-request' ? 'local-ai-protocol' : error instanceof LemonadeStatusError ? `local-ai-${error.code}` : 'local-ai-unavailable'; return Response.json({ error: { code, message: 'The local AI runtime status could not be read.' } }, { status }); }
    }
    if (url.pathname !== '/api/v1/local-ai/operations' || request.method !== 'POST') return null;
    if (!descriptor) return Response.json({ error: { code: 'local-ai-unavailable', message: 'The local AI runtime is not configured.' } }, { status: 503 });
    const body = await request.json().catch(() => null) as unknown;
    if (!isLemonadeOperation(body)) return Response.json({ error: { code: 'local-ai-invalid-request', message: 'Choose a valid local AI operation.' } }, { status: 400 });
    try {
      // Storage paths originate only from the native-authorized import route.
      if (body.operation === 'set-config' && (!body.input || ['extra_models_dir', 'models_dir'].includes(body.input.key))) throw new LemonadeStatusError('invalid-request');
      if (body.operation === 'register-model') {
        const input = body.input as Record<string, unknown>;
        if (!validateOwnedModelRegistration(input)) throw new LemonadeStatusError('invalid-request');
        const modelsDirectory = process.env.OFFICE_LEMONADE_MODELS_DIR;
        if (!modelsDirectory) throw new LemonadeStatusError('unavailable');
        const checkpoint = canonicalModelDirectory(modelsDirectory, input.checkpoint);
        const adapter = new LemonadeManagementAdapter(descriptor);
        const result = await runLemonadeOperation(adapter, { operation: 'register-model', input: { model_name: input.model_name, recipe: input.recipe, checkpoint } }, { signal: request.signal } satisfies LemonadeRequestOptions);
        return Response.json({ result }, { headers: { 'Cache-Control': 'no-store' } });
      }
      const adapter = new LemonadeManagementAdapter(descriptor);
      const result = await runLemonadeOperation(adapter, body, { signal: request.signal } satisfies LemonadeRequestOptions);
      return Response.json({ result }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const status = error instanceof LemonadeStatusError ? safeStatuses[error.code] : 400;
      const code = error instanceof LemonadeStatusError ? `local-ai-${error.code}` : 'local-ai-invalid-request';
      return Response.json({ error: { code, message: error instanceof LemonadeStatusError && error.code === 'upstream' ? 'Local AI rejected the operation.' : 'The local AI operation could not be completed.' } }, { status });
    }
  };
}
