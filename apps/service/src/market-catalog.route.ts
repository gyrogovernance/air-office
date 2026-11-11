import { MarketCatalogError, type MarketCatalogService } from '@office/methods/service';
import type { AutomationDefinition } from '@office/automations/domain';

export function nativeMarketAutomations(timezone = 'UTC', now = new Date()) {
  // Check the operator's zone before producing definitions for the calendar import path.
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format(now);
  const timestamp = now.toISOString();
  const date = timestamp.slice(0, 10);
  const templates = [
    { id: 'daily-focus', name: 'Daily focus plan', description: 'Prepare a short planning worksheet each morning.', frequency: 'daily' as const, weekdays: [], localTime: '09:00', prompt: 'Prepare a concise daily planning worksheet with space for three priorities, appointments, focused work and a closing review. Use only context supplied in this automation; leave unknown details as questions. Do not invent calendar access or current events.' },
    { id: 'weekly-review', name: 'Weekly review', description: 'Create a Friday review of progress and next steps.', frequency: 'weekly' as const, weekdays: [5], localTime: '16:00', prompt: 'Create a weekly review worksheet covering completed work, unresolved questions, lessons and three next steps. Use only supplied context and clearly mark unanswered questions. Do not claim to have read chats, files or calendars.' },
    { id: 'meeting-preparation', name: 'Meeting preparation', description: 'Prepare a reusable Monday meeting agenda and checklist.', frequency: 'weekly' as const, weekdays: [1], localTime: '08:30', prompt: 'Draft a practical meeting preparation worksheet with objectives, participants, decisions needed, discussion questions and follow-up owners. Leave placeholders for details absent from the supplied context; do not invent meeting records.' }
  ];
  return templates.map((item) => {
    const definition: AutomationDefinition = { id: `market-${item.id}`, name: item.name, enabled: false, missedRunPolicy: 'skip', recurrence: { frequency: item.frequency, interval: 1, weekdays: item.weekdays, localTime: item.localTime, timezone, startDate: date }, steps: [{ kind: 'prompt', prompt: item.prompt }], createdAt: timestamp, updatedAt: timestamp };
    return { id: `native:${item.id}`, kind: 'automation' as const, name: item.name, description: item.description, sourceUrl: 'air-office:native-automations', license: 'AIR Office native template', definition };
  });
}

/** Wire behind the existing session/origin authorization in the service composition root. */
export function createMarketCatalogRoutes(catalog: MarketCatalogService) {
  return async (request: Request, url: URL): Promise<Response | null> => {
    try {
      if (url.pathname === '/api/v1/market/catalog' && request.method === 'GET') {
        const kind = url.searchParams.get('kind');
        if (kind !== 'skill' && kind !== 'automation') return Response.json({ error: 'Choose kind=skill or kind=automation.' }, { status: 400 });
        const result = await catalog.catalog(kind);
        if (kind === 'automation') {
          try { return Response.json({ ...result, entries: result.sources.some((source) => source.enabled) ? nativeMarketAutomations(url.searchParams.get('timezone') ?? 'UTC') : [] }, { headers: { 'Cache-Control': 'no-store' } }); }
          catch { return Response.json({ error: 'Use a valid IANA timezone.' }, { status: 400 }); }
        }
        return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/api/v1/market/sources') {
        if (request.method === 'GET') return Response.json({ sources: catalog.sources() });
        if (request.method === 'PUT') {
          if (Number(request.headers.get('content-length')) > 16000) return Response.json({ error: 'Market settings exceed the size limit.' }, { status: 413 });
          const text = await request.text();
          if (text.length > 16000) return Response.json({ error: 'Market settings exceed the size limit.' }, { status: 413 });
          let value: unknown;
          try { value = JSON.parse(text); } catch { throw new MarketCatalogError('Provide valid source settings JSON.'); }
          if (!value || typeof value !== 'object' || !('sources' in value)) throw new MarketCatalogError('Provide a sources array.');
          return Response.json({ sources: catalog.saveSources(value.sources) });
        }
      }
      if (url.pathname === '/api/v1/market/skills/preview' && request.method === 'GET') {
        const id = url.searchParams.get('id');
        if (!id || id.length > 400) throw new MarketCatalogError('Provide a catalog skill ID.');
        return Response.json(await catalog.previewSkill(id), { headers: { 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/api/v1/market/skills/install' && request.method === 'POST') {
        const body: unknown = await request.json().catch(() => null);
        if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string' || body.id.length > 400) throw new MarketCatalogError('Provide a catalog skill ID.');
        return Response.json({ definition: await catalog.installSkill(body.id) }, { status: 201 });
      }
      return null;
    } catch (error) {
      return Response.json({ error: error instanceof MarketCatalogError ? error.message : 'The Market request failed. Retry later.' }, { status: error instanceof MarketCatalogError ? 400 : 502 });
    }
  };
}
