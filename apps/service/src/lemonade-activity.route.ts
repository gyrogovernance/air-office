import type { LemonadeRuntimeDescriptor } from '@office/providers/lemonade-status';
import type { createLemonadeActivityJournal } from './lemonade-activity.adapter';

type Route = (request: Request, url: URL) => Promise<Response | null>;
type Journal = ReturnType<typeof createLemonadeActivityJournal>;

/** Mounted inside AIR authentication and inside the private import/deletion guard. */
type DescriptorArg = LemonadeRuntimeDescriptor | null | (() => LemonadeRuntimeDescriptor | null);
const resolveDescriptor = (value: DescriptorArg) => typeof value === 'function' ? value() : value;

export function createLemonadeActivityRoutes(getDescriptor: DescriptorArg, journal: Journal, next: Route): Route {
  return async (request, url) => {
    const descriptor = resolveDescriptor(getDescriptor);
    if (url.pathname === '/api/v1/local-ai/download-history' && request.method === 'GET') {
      if (descriptor) {
        const operationsUrl = new URL('/api/v1/local-ai/operations', url);
        const observation = await next(new Request(operationsUrl, { method: 'POST', headers: request.headers, body: JSON.stringify({ operation: 'downloads' }), signal: request.signal }), operationsUrl);
        if (!observation) return new Response('Download history is unavailable.', { status: 502, headers: { 'Cache-Control': 'no-store' } });
        if (!observation.ok) return new Response(observation.body, { status: observation.status, statusText: observation.statusText, headers: { 'Cache-Control': 'no-store' } });
        const payload = await observation.json().catch(() => null) as { result?: unknown } | null;
        if (!payload || !('result' in payload)) return new Response('Download history could not be refreshed.', { status: 502, headers: { 'Cache-Control': 'no-store' } });
        journal.observe(payload.result, true);
      }
      return Response.json({ activities: journal.list(), current: descriptor ? { instanceId: descriptor.instanceId, generation: descriptor.generation } : null }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (url.pathname !== '/api/v1/local-ai/operations' || request.method !== 'POST') return next(request, url);
    const body = await request.clone().json().catch(() => null) as { operation?: unknown; input?: { id?: unknown; action?: unknown } } | null;
    const response = await next(request, url);
    if (!response?.ok || !descriptor || !body || !['pull', 'downloads', 'download-control', 'install'].includes(String(body.operation))) return response;
    const payload = await response.clone().json().catch(() => null) as { result?: unknown } | null;
    if (payload && 'result' in payload) {
      journal.observe(payload.result, body.operation === 'downloads');
      if (body.operation === 'download-control') journal.control(body.input?.id, body.input?.action);
    }
    return response;
  };
}
