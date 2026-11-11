import { ModelConnectionSettingsError } from '@office/providers/service';
import type { ModelConnectionSettings } from '@office/providers/service';

/** HTTP translation only. Connection mutations, credentials and observations belong to providers. */
export function createModelSettingsRoutes(settings: ModelConnectionSettings, reservedConnectionIds: readonly string[] = []) {
  const reserved = new Set(reservedConnectionIds);
  const isReservedBody = (body: unknown) => Boolean(body && typeof body === 'object' && !Array.isArray(body) && (() => { const connection = (body as { connection?: unknown }).connection ?? body; return connection && typeof connection === 'object' && !Array.isArray(connection) && typeof (connection as { id?: unknown }).id === 'string' && reserved.has((connection as { id: string }).id); })());
  return async (request: Request, url: URL): Promise<Response | null> => {
    try {
      if (url.pathname === '/api/v1/model-connections') {
        if (request.method === 'GET') return Response.json({ connections: await Promise.all(settings.list().map(async (item) => ({ ...item, credentialConfigured: await settings.configured(item) }))) });
        if (request.method === 'PUT') {
          const body = await request.json().catch(() => null);
          if (isReservedBody(body)) return Response.json({ error: 'This provider identity belongs to the managed local runtime.' }, { status: 409 });
          return Response.json(await settings.save(body));
        }
      }
      const match = url.pathname.match(/^\/api\/v1\/model-connections\/([a-z0-9-]+)(?:\/(discover|health))?$/);
      if (!match) return null;
      if (reserved.has(match[1]!)) return Response.json({ error: 'This provider identity belongs to the managed local runtime.' }, { status: 409 });
      if (request.method === 'GET' && match[2] === 'health') {
        return Response.json(await settings.check(match[1]!, request.signal));
      }
      if (request.method === 'DELETE' && !match[2]) return Response.json(await settings.remove(match[1]!));
      if (request.method !== 'POST') return null;
      if (match[2] === 'discover') return Response.json(await settings.discover(match[1]!, request.signal));
      return null;
    } catch (error) {
      if (error instanceof ModelConnectionSettingsError) {
        const status = { invalid: 400, missing: 404, conflict: 409, 'credential-write': 503, 'credential-delete': 502, discovery: 502 }[error.code];
        return Response.json({ error: error.message, code: error.code, ...(error.connection ? { connection: error.connection, saved: error.saved, credentialSaved: false } : {}) }, { status });
      }
      return Response.json({ error: 'The model operation could not complete. Check the runtime and retry.' }, { status: 502 });
    }
  };
}
