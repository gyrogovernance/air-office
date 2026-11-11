import { afterAll, expect, spyOn, test } from 'bun:test';
import '../../support/web-dom.adapter';

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { useProviderCatalog } = await import('../../../apps/web/src/models/providers-catalog.hook');

test('catalog refresh keeps an unavailable exact selection and never selects demo replay implicitly', async () => {
  window.localStorage.removeItem('air-office:selected-model');
  const previous = window.__AIR_SERVICE_BASE__;
  window.__AIR_SERVICE_BASE__ = 'http://127.0.0.1:45990';
  let available = true; let failed = false;
  const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL) => {
    if (new URL(String(input)).pathname === '/bootstrap') return Response.json({ token: 'fixture' });
    if (failed) throw new Error('Connection unavailable');
    return Response.json({ providers: [{ id: 'local-replay', models: ['local-replay'] }, ...(available ? [{ id: 'managed-local', models: ['org/chat:Q4'] }] : [])] });
  }, { preconnect: fetch.preconnect }));
  const host = document.createElement('div'); document.body.append(host); let root = createRoot(host);
  function Harness() {
    const catalog = useProviderCatalog();
    return <><output>{catalog.selectedProvider ?? 'none'}|{catalog.selectedModel ?? 'none'}</output><button onClick={() => catalog.selectModel('managed-local:org/chat:Q4')}>Select</button><button onClick={() => void catalog.refresh()}>Refresh</button><button onClick={() => catalog.selectModel('managed-local:newly-downloaded:Q4')}>Select downloaded model</button><span>{catalog.error}</span></>;
  }
  try {
    await act(async () => root.render(<Harness />));
    expect(host.querySelector('output')?.textContent).toBe('none|none');
    await act(async () => host.querySelector('button')!.click());
    expect(host.querySelector('output')?.textContent).toBe('managed-local|org/chat:Q4');
    available = false;
    await act(async () => host.querySelectorAll('button')[1]!.click());
    expect(host.querySelector('output')?.textContent).toBe('managed-local|org/chat:Q4');
    failed = true;
    await act(async () => host.querySelectorAll('button')[1]!.click());
    expect(host.querySelector('output')?.textContent).toBe('managed-local|org/chat:Q4');
    expect(host.textContent).toContain('Connection unavailable');
    await act(async () => host.querySelectorAll('button')[2]!.click());
    expect(host.querySelector('output')?.textContent).toBe('managed-local|newly-downloaded:Q4');
  } finally {
    await act(async () => root.unmount()); host.remove(); mock.mockRestore();
    if (previous === undefined) Reflect.deleteProperty(window, '__AIR_SERVICE_BASE__'); else window.__AIR_SERVICE_BASE__ = previous;
  }
});

test('catalog selection persists across remounts and takes precedence over workspace defaults', async () => {
  const previous = window.__AIR_SERVICE_BASE__;
  window.__AIR_SERVICE_BASE__ = 'http://127.0.0.1:45990';
  const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL) => {
    if (new URL(String(input)).pathname === '/bootstrap') return Response.json({ token: 'fixture' });
    if (new URL(String(input)).pathname === '/api/v1/providers') return Response.json({ providers: [{ id: 'local-replay', models: ['local-replay'] }, { id: 'managed-local', models: ['Bonsai', 'Preferred'] }] });
    return Response.json({ defaults: { chatProvider: 'managed-local', chatModel: 'Bonsai' } });
  }, { preconnect: fetch.preconnect }));
  const host = document.createElement('div'); document.body.append(host); let root = createRoot(host);
  function Harness() {
    const catalog = useProviderCatalog();
    return <><output>{catalog.selectedProvider ?? 'none'}|{catalog.selectedModel ?? 'none'}</output><button onClick={() => catalog.selectModel('managed-local:Preferred')}>Select preferred</button></>;
  }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => host.querySelector('button')!.click());
    expect(host.querySelector('output')?.textContent).toBe('managed-local|Preferred');
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<Harness />));
    expect(host.querySelector('output')?.textContent).toBe('managed-local|Preferred');
  } finally {
    await act(async () => root.unmount()); host.remove(); mock.mockRestore();
    window.localStorage.removeItem('air-office:selected-model');
    if (previous === undefined) Reflect.deleteProperty(window, '__AIR_SERVICE_BASE__'); else window.__AIR_SERVICE_BASE__ = previous;
  }
});

