import { expect, test } from 'bun:test';
import { createMarketCatalogRoutes, nativeMarketAutomations } from '../../../apps/service/src/market-catalog.route';
import { createMarketCatalogService, defaultMarketSources, parseMarketSources } from '@office/methods/service';
import { validateAutomation } from '@office/automations/domain';
import { parseCalendarBundle } from '../../../apps/service/src/calendar-exchange.adapter';

test('native Market templates are paused valid calendar imports without external tool claims', () => {
  const entries = nativeMarketAutomations('Europe/Athens', new Date('2026-10-18T12:00:00Z'));
  expect(entries).toHaveLength(3);
  for (const entry of entries) {
    expect(entry.kind).toBe('automation'); expect(entry.definition.enabled).toBe(false);
    expect(validateAutomation(entry.definition)).toBe(true);
    expect(entry.definition.steps.every((step) => step.kind === 'prompt')).toBe(true);
    const bundle = parseCalendarBundle({ schema_version: 1, calendars: [], events: [], automations: [entry.definition] });
    expect(bundle.automations[0]?.enabled).toBe(false);
  }
});
test('routes expose only skills and automations and source settings reject arbitrary URLs', async () => {
  const sources = { list: () => structuredClone([...defaultMarketSources]), replace: parseMarketSources, close() {} };
  const service = createMarketCatalogService({ sources, methods: { save: (definition) => definition }, fetch: async () => new Response('', { status: 503 }) });
  const route = createMarketCatalogRoutes(service);
  const request = (path: string, method = 'GET', body?: unknown) => { const url = new URL(`http://localhost${path}`); return route(new Request(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), url); };
  expect((await request('/api/v1/market/catalog?kind=prompt'))?.status).toBe(400);
  const automations = await (await request('/api/v1/market/catalog?kind=automation&timezone=Europe/Athens'))?.json();
  expect(automations.entries).toHaveLength(3); expect(automations.sources[0].kind).toBe('automation');
  expect((await request('/api/v1/market/catalog?kind=automation&timezone=bad'))?.status).toBe(400);
  expect((await request('/api/v1/market/sources'))?.status).toBe(200);
  expect((await request('/api/v1/market/sources', 'PUT', { sources: [{ ...defaultMarketSources[0], url: 'https://unknown.example/catalog.json' }] }))?.status).toBe(400);
  expect((await request('/api/v1/market/skills/install', 'POST', { id: 3 }))?.status).toBe(400);
  expect(await request('/unrelated')).toBeNull();
});
