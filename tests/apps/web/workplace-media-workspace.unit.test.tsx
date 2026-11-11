import { afterAll, expect, test } from 'bun:test';
import { createElement } from 'react';
import { WorkplaceMediaWorkspace } from '../../../apps/web/src/media/workplace-media-workspace.component';
import { createServiceClient } from '../../../apps/web/src/shared/service-client.hook';
import { imageQualities, imageShapes } from '../../../apps/web/src/models/local-ai/media-capability.policy';
import '../../support/web-dom.adapter';


const { act } = await import('react');
const { createRoot } = await import('react-dom/client');

test.each(['binary', 'base64-json'] as const)('Media workspace previews authenticated image output (%s)', async (format) => {
  const previousFetch = globalThis.fetch; const previousCreate = URL.createObjectURL; const previousRevoke = URL.revokeObjectURL;
  const calls: { path: string; init: RequestInit }[] = []; const revoked: string[] = [];
  URL.createObjectURL = () => 'blob:workplace-image'; URL.revokeObjectURL = (url) => { revoked.push(url); };
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/bootstrap')) return Response.json({ token: 'workplace-session' });
    const path = new URL(String(input)).pathname; calls.push({ path, init: init ?? {} });
    if (path === '/api/v1/local-ai/operations') return Response.json({ result: [{ id: 'local-image', recipe: 'sd-cpp', labels: ['image'] }, { id: 'audio-ready', recipe: 'acestep', labels: ['audio-generation'] }, { id: 'chat-only', recipe: 'llamacpp', labels: ['chat'] }] });
    if (format === 'base64-json') return Response.json({ data: [{ b64_json: btoa('image') }] });
    return new Response(new Blob(['image'], { type: 'image/png' }), { headers: { 'content-type': 'image/png' } });
  }) as typeof fetch;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const setValue = async (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
  try {
    await act(async () => root.render(createElement(WorkplaceMediaWorkspace, { client: createServiceClient('http://127.0.0.1:4488'), appearance: 'light' })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.querySelector('[aria-label="Media"]')).not.toBeNull();
    expect(host.querySelector('.workspace-hero__subtitle')?.textContent).toContain('Generate images');
    expect([...host.querySelectorAll('option')].map((option) => option.value)).toContain('local-image');
    expect([...host.querySelectorAll('option')].map((option) => option.value)).not.toContain('chat-only');
    await setValue(host.querySelector('select')!, 'local-image');
    await setValue(host.querySelector('textarea')!, 'a red kite');
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Generate')!.click());
    expect(calls.map((call) => call.path)).toEqual(['/api/v1/local-ai/operations', '/api/v1/local-ai/images/generations']);
    expect(new Headers(calls[1]!.init.headers).get('authorization')).toBe('Bearer workplace-session');
    // The engine takes a shape and a quality, so the request carries the
    // chosen size and the step count alongside the model and the prompt.
    const body = JSON.parse(String(calls[1]!.init.body)) as { model: string; prompt: string; size: string; steps: number };
    expect(body).toMatchObject({ model: 'local-image', prompt: 'a red kite' });
    expect(imageShapes.map((shape) => shape.size)).toContain(body.size);
    expect(imageQualities.map((quality) => quality.steps)).toContain(body.steps);
    expect(host.querySelector('[aria-label="Generated media"] img')?.getAttribute('src')).toBe('blob:workplace-image');
    expect(host.querySelector('[aria-label="Generated media"] a[download]')?.getAttribute('download')).toContain('image');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.fetch = previousFetch;
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  }
});

test('Media workspace shows empty guidance and can open Models settings', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    if (String(input).endsWith('/bootstrap')) return Response.json({ token: 'workplace-session' });
    if (new URL(String(input)).pathname === '/api/v1/local-ai/operations') return Response.json({ result: [] });
    throw new Error(`Unexpected ${String(input)}`);
  }) as typeof fetch;
  const opened: string[] = [];
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(WorkplaceMediaWorkspace, { client: createServiceClient('http://127.0.0.1:4489'), onOpenModels: () => opened.push('models') })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.textContent).toContain('No Local AI models are available for generation yet.');
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Open Models settings')!.click());
    expect(opened).toEqual(['models']);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.fetch = previousFetch;
  }
});

test('failed listing has retry without claiming the model library is empty', async () => {
  let fail = true;
  const client = { json: async () => { if (fail) throw new Error('private upstream details'); return { result: [] }; } } as unknown as ReturnType<typeof createServiceClient>;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(WorkplaceMediaWorkspace, { client })));
    expect(host.textContent).toContain('Local AI models could not be loaded.');
    expect(host.textContent).not.toContain('No Local AI models');
    expect(host.textContent).not.toContain('private upstream');
    fail = false;
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Retry')!.click());
    expect(host.textContent).toContain('No Local AI models are available');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
