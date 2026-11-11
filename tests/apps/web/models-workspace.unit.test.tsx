import { afterAll, expect, spyOn, test } from 'bun:test';
import type { ModelConnection } from '@office/providers/domain';
import '../../support/web-dom.adapter';


const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AppDialogsProvider } = await import('../../../apps/web/src/shared/app-dialogs.component');
const { ModelsWorkspace } = await import('../../../apps/web/src/models/models-workspace.component');

test('failed key replacement refreshes saved state, retains draft edits and permits cleanup and retry', async () => {
  const initial: ModelConnection = { id: 'cloud', name: 'Cloud', kind: 'openai-compatible', baseUrl: 'https://original.example/v1', models: ['manual'], imageModels: [], observedModels: [], observedAt: null, discovery: 'unknown', discoveryError: null };
  let persisted = { ...initial, credentialConfigured: true };
  let fail = true;
  let reads = 0;
  const writes: { connection: ModelConnection; secret: string }[] = [];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'test-session' });
    if (path === '/api/v1/model-connections' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { connection: ModelConnection; secret: string };
      writes.push(body);
      if (fail) { persisted = { ...persisted, retiredCredentialIds: ['model-key-staged'] }; return Response.json({ code: 'credential-write', error: 'Replacement key could not be stored.', connection: persisted, saved: false }, { status: 503 }); }
      persisted = { ...body.connection, credentialConfigured: true };
      return Response.json({ connection: persisted, saved: true, credentialSaved: true });
    }
    if (path === '/api/v1/model-connections') { reads++; return Response.json({ connections: [persisted] }); }
    if (path.endsWith('/discover')) return Response.json({ discovered: persisted.models.length, empty: persisted.models.length === 0, connection: { ...persisted, discovery: persisted.models.length ? 'success' : 'empty' } });
    if (path === '/api/v1/model-harness') return Response.json({ models: [] });
    if (path === '/api/v1/cloud/chatgpt/status') return Response.json({ status: 'disconnected', sessionId: null, accounts: [], activeAccountId: null });
    throw new Error(`Unexpected request: ${path}`);
  }, { preconnect: fetch.preconnect }));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  // The connection editor renders in a body-level modal portal, so dialog
  // content is queried from the document rather than the mount host.
  const button = (label: string) => [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)!;
  const type = async (input: HTMLInputElement, text: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); }); };
  try {
    await act(async () => { root.render(<ModelsWorkspace scope="cloud" />); });
    await act(async () => { host.querySelector<HTMLButtonElement>('.model-connection')!.click(); });
    const endpoint = document.querySelector<HTMLInputElement>('input[type="url"]')!;
    const key = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    await type(endpoint, 'https://replacement.example/v1');
    await type(key, 'replacement-secret');
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Replacement key could not be stored');
    expect(reads).toBe(2);
    expect(endpoint.value).toBe('https://replacement.example/v1');
    expect(key.value).toBe('replacement-secret');
    expect(button('Remove').disabled).toBe(false);
    expect(persisted.baseUrl).toBe(initial.baseUrl);
    fail = false;
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(writes).toHaveLength(2);
    expect(writes[1]?.connection.baseUrl).toBe('https://replacement.example/v1');
    expect(writes[1]?.secret).toBe('replacement-secret');
    expect(key.value).toBe('');
    expect(document.body.textContent).toContain('Connection saved.');
  } finally { await act(async () => root.unmount()); host.remove(); fetchMock.mockRestore(); }
});


test('native cloud templates retain protocol and setup exposes engines and current download history', async () => {
  let written: ModelConnection | null = null;
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'session' });
    if (path === '/api/v1/model-connections' && init?.method === 'PUT') { written = (JSON.parse(String(init.body)) as { connection: ModelConnection }).connection; return Response.json({ connection: written }); }
    if (path === '/api/v1/model-connections') return Response.json({ connections: written ? [written] : [] });
    if (path.endsWith('/discover') && written) return Response.json({ discovered: 0, empty: true, connection: { ...written, discovery: 'empty' } });
    if (path === '/api/v1/model-harness') return Response.json({ models: [] });
    if (path === '/api/v1/local-ai/download-history') return Response.json({ activities: [] });
    if (path === '/api/v1/local-ai/model-scan') return Response.json({ locations: [], models: [], warnings: [], scannedAt: null, canImport: true });
    if (path === '/api/v1/cloud/chatgpt/status') return Response.json({ status: 'disconnected', sessionId: null, accounts: [], activeAccountId: null });
    throw new Error('Unexpected request ' + path);
  }, { preconnect: fetch.preconnect }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const button = (label: string) => [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)!;
  try {
    await act(async () => root.render(<ModelsWorkspace scope="cloud" />));
    await act(async () => button('Add connection').click());
    const templates = [...host.querySelectorAll<HTMLButtonElement>('.model-template-grid button')];
    expect(templates.map((item) => item.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Anthropic'), expect.stringContaining('Gemini'), expect.stringContaining('Azure OpenAI'), expect.stringContaining('OpenAI Responses')]));
    await act(async () => templates.find((item) => item.textContent?.startsWith('Anthropic'))!.click());
    expect(document.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe('https://api.anthropic.com/v1');
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(written as ModelConnection | null).toMatchObject({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' });
    expect(host.querySelector('nav')).toBeNull();
    expect(button('Hardware & fit')).toBeUndefined();
    expect(button('Add model')).toBeUndefined();
    await act(async () => root.render(<AppDialogsProvider><ModelsWorkspace key="local" scope="local" /></AppDialogsProvider>));
    expect(host.querySelector('[aria-label="Local models"]')).not.toBeNull();
    expect(host.querySelector('nav')).toBeNull();
    expect(host.textContent).not.toContain('Runtime settings');
    expect(host.textContent).not.toContain('Register from AIR storage');
  } finally { await act(async () => root.unmount()); host.remove(); fetchMock.mockRestore(); }
});


test('switching the edited connection discards a late check result from the previous endpoint', async () => {
  const first: ModelConnection = { id: 'first', name: 'First', kind: 'openai-compatible', baseUrl: 'https://first.example', models: [], imageModels: [], observedModels: [], observedAt: null, discovery: 'unknown', discoveryError: null };
  const second = { ...first, id: 'second', name: 'Second', baseUrl: 'https://second.example' };
  let release: (response: Response) => void = () => {};
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'session' });
    if (path === '/api/v1/model-connections' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { connection: ModelConnection };
      return Response.json({ connection: body.connection });
    }
    if (path === '/api/v1/model-connections') return Response.json({ connections: [first, second] });
    if (path.endsWith('/discover')) {
      const id = path.split('/')[4];
      const connection = id === 'second' ? second : first;
      return Response.json({ discovered: 0, empty: true, connection: { ...connection, discovery: 'empty' } });
    }
    if (path.endsWith('/first/health')) return new Promise<Response>((resolve) => { release = resolve; });
    if (path === '/api/v1/model-harness') return Response.json({ models: [] });
    if (path === '/api/v1/cloud/chatgpt/status') return Response.json({ status: 'disconnected', sessionId: null, accounts: [], activeAccountId: null });
    throw new Error('Unexpected request ' + path);
  }, { preconnect: fetch.preconnect }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ModelsWorkspace scope="cloud" />));
    await act(async () => host.querySelectorAll<HTMLButtonElement>('.model-connection')[0]!.click());
    await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save and Test')!.click());
    await act(async () => host.querySelectorAll<HTMLButtonElement>('.model-connection')[1]!.click());
    await act(async () => release(Response.json({ state: 'reachable', message: 'FIRST_ENDPOINT_RESULT' })));
    expect(document.body.textContent).not.toContain('FIRST_ENDPOINT_RESULT');
    expect(document.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe('https://second.example');
  } finally { await act(async () => root.unmount()); host.remove(); fetchMock.mockRestore(); }
});

