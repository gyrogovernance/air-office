import { afterAll, expect, spyOn, test } from 'bun:test';
import '../../support/web-dom.adapter';

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { StorageLocationSettings } = await import('../../../apps/web/src/settings/storage-location-settings.component');

test('Data storage saves and cancels a pending data folder without claiming it is already active', async () => {
  const writes: unknown[] = [];
  const state = { current: { private: 'C:\\AIR\\private', public: 'C:\\AIR\\public', models: 'C:\\AIR\\models', cache: 'C:\\AIR\\cache' }, pending: null as string | null, pendingModels: null as string | null, canRelocate: true };
  const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(input)).pathname === '/bootstrap') return Response.json({ token: 'fixture' });
    if (init?.method === 'PUT') { const body = JSON.parse(String(init.body)) as { destination?: string | null; modelsDestination?: string | null }; writes.push(body); if (body.destination !== undefined) state.pending = body.destination; if (body.modelsDestination !== undefined) state.pendingModels = body.modelsDestination; }
    return Response.json(state);
  }, { preconnect: fetch.preconnect }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<StorageLocationSettings/>));
    const input = host.querySelector<HTMLInputElement>('[aria-label="AIR Office data folder"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'D:\\AIR Office'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    const apply = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Apply')!;
    await act(async () => apply.click());
    expect(writes).toEqual([{ destination: 'D:\\AIR Office' }]);
    expect(host.textContent).toContain('Restart AIR Office to use D:\\AIR Office.');
    expect(host.querySelector('details')).toBeNull();
    expect(host.querySelector('[aria-label="Storage areas"]')?.textContent).toContain('C:\\AIR\\cache');
    expect(host.textContent).toContain('C:\\AIR\\private');
    expect([...host.querySelectorAll('button')].some((button) => button.textContent === 'Browse')).toBe(true);
    expect(host.textContent).not.toContain('The new folder is active');
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Cancel')!.click());
    expect(writes.at(-1)).toEqual({ destination: null, modelsDestination: null });
    expect(host.querySelector('[role="status"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); mock.mockRestore(); }
});

test('the models folder is chosen apart from the content folder', async () => {
  const writes: unknown[] = [];
  const state = { current: { private: 'C:\\AIR\\private', public: 'C:\\AIR\\public', models: 'C:\\AIR\\models', cache: 'C:\\AIR\\cache' }, pending: null as string | null, pendingModels: null as string | null, canRelocate: true };
  const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(input)).pathname === '/bootstrap') return Response.json({ token: 'fixture' });
    if (init?.method === 'PUT') { const body = JSON.parse(String(init.body)) as { modelsDestination?: string | null }; writes.push(body); if (body.modelsDestination !== undefined) state.pendingModels = body.modelsDestination; }
    return Response.json(state);
  }, { preconnect: fetch.preconnect }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<StorageLocationSettings/>));
    const input = host.querySelector<HTMLInputElement>('[aria-label="AI models folder"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'D:\\Models'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    const apply = [...host.querySelectorAll('button')].filter((button) => button.textContent === 'Apply')[1]!;
    await act(async () => apply.click());
    expect(writes).toEqual([{ modelsDestination: 'D:\\Models' }]);
    expect(host.textContent).toContain('Restart AIR Office to use D:\\Models.');
  } finally { await act(async () => root.unmount()); host.remove(); mock.mockRestore(); }
});
