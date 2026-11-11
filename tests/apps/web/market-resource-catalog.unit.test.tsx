import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import '../../support/web-dom.adapter';

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MarketResourceCatalog } = await import('../../../apps/web/src/market/market-resource-catalog.component');
const { MarketAutomationsCatalog } = await import('../../../apps/web/src/market/market-automations-catalog.component');
const { createServiceClient } = await import('../../../apps/web/src/shared/service-client.hook');
const requests: { path: string; body: unknown }[] = [];
const fixture = {
  skill: { id: 'community-review', kind: 'skill', name: 'Review evidence', description: 'Check evidence and uncertainties.', instructions: 'Read the sources and identify gaps.', sourceUrl: 'https://example.com/review', license: 'MIT' },
  automation: { id: 'weekly-review', kind: 'automation', name: 'Weekly review', description: 'Review recent work.', sourceUrl: '', license: 'MIT', definition: { id: 'starter-weekly', name: 'Weekly review', enabled: true, recurrence: { frequency: 'weekly', interval: 1, weekdays: [1], startDate: '2026-10-18', localTime: '09:00', timezone: 'UTC' }, missedRunPolicy: 'skip', steps: [{ kind: 'prompt', prompt: 'Review recent work.' }], createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z' } },
};
const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname === '/bootstrap') return Response.json({ token: 'test' });
  if (url.pathname === '/api/v1/market/catalog') return Response.json({ entries: [fixture[url.searchParams.get('kind') as keyof typeof fixture]] });
  if (url.pathname === '/api/v1/market/skills/preview') return Response.json(fixture.skill);
  if (init?.method === 'POST') { requests.push({ path: url.pathname, body: JSON.parse(String(init.body)) }); return Response.json({}); }
  throw new Error('Unexpected request');
}, { preconnect: globalThis.fetch.preconnect }));
let host: HTMLElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
async function mount(kind: 'skill' | 'automation', onOpenSchedules?: () => void) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(kind === 'skill' ? createElement(MarketResourceCatalog, { kind, client: createServiceClient(), onInstalled: () => undefined }) : createElement(MarketAutomationsCatalog, { client: createServiceClient(), onInstalled: () => undefined, onOpenSchedules })); });
  return host;
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null; requests.length = 0; });
afterAll(() => { fetchMock.mockRestore(); });

test('community skill previews original instructions and installs an independent editable copy', async () => {
  const container = await mount('skill');
  await act(async () => { container.querySelector<HTMLButtonElement>('.market-row button')!.click(); });
  expect(document.querySelector('[aria-label="Skill instructions"]')?.textContent).toContain(fixture.skill.instructions);
  expect(document.querySelector<HTMLAnchorElement>('a[href="https://example.com/review"]')?.href).toBe(fixture.skill.sourceUrl);
  await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === 'Add to workspace')!.click(); });
  expect(requests[0]?.path).toBe('/api/v1/market/skills/install');
  expect(requests[0]?.body).toEqual({ id: fixture.skill.id });
  expect(document.querySelector('[role="dialog"] [role="status"]')?.textContent).toContain('editable copy');
});

test('automation installation forces a fresh identity and paused state', async () => {
  let opened = false;
  const container = await mount('automation', () => { opened = true; });
  await act(async () => { container.querySelector<HTMLButtonElement>('.market-automations__card button')!.click(); });
  await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === 'Add template')!.click(); });
  expect(requests[0]?.path).toBe('/api/v1/calendar/import');
  expect(requests[0]?.body).toMatchObject({ bundle: { schema_version: 1, automations: [{ enabled: false, name: 'Weekly review' }] } });
  expect(JSON.stringify(requests[0]?.body)).not.toContain('starter-weekly');
  expect(document.querySelector('[role="dialog"] [role="status"]')?.textContent).toContain('paused');
  await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === 'Open schedules')!.click(); });
  expect(opened).toBe(true);
});
