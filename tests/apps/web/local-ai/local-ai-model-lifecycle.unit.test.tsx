import { afterAll, expect, spyOn, test } from 'bun:test';
import '../../../support/web-dom.adapter';

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { createServiceClient } = await import('../../../../apps/web/src/shared/service-client.hook');
const { LocalAiModelActions, LocalAiModelOptions, LocalAiModelUpdates } = await import('../../../../apps/web/src/models/local-ai/local-ai-model-lifecycle.component');

test('authenticated lifecycle controls separate saved options, pin both ways and explicitly download checked updates', async () => {
  const calls: Record<string, unknown>[] = []; let saved = { ctx_size: 2048 }; let changed = 0;
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(input)).pathname === '/bootstrap') return Response.json({ token: 'lifecycle-session' });
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer lifecycle-session');
    const value = JSON.parse(String(init?.body)) as Record<string, unknown>; calls.push(value);
    if (value.operation === 'installed-models') return Response.json({ result: { data: [{ id: 'fixture' }] } });
    if (value.operation === 'save-model-options') saved = value.options as typeof saved;
    if (value.operation === 'reset-model-options') saved = {} as typeof saved;
    return Response.json({ result: value.operation === 'model-options' ? { saved, effective: { ctx_size: 2048, threads: 4, checkpoint: 'C:/private/model', api_key: 'hidden' }, defaults: { ctx_size: 4096, threads: 4 } } : value.operation === 'check-updates' ? { models: ['fixture'], failed_models: {} } : { ok: true } });
  }, { preconnect: fetch.preconnect }));
  const client = createServiceClient('http://127.0.0.1:4567'); const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!;
  try {
    await act(async () => root.render(<><LocalAiModelActions model="fixture" client={client} onChanged={async () => { changed++; }} onOptions={() => {}} /><LocalAiModelOptions client={client} initialModel="fixture" /><LocalAiModelUpdates client={client} onChanged={async () => { changed++; }} /></>));
    await act(async () => button('Pin').click()); await act(async () => button('Unpin').click());
    expect(calls).toContainEqual({ operation: 'pin', input: { model_name: 'fixture', pinned: true } }); expect(calls).toContainEqual({ operation: 'pin', input: { model_name: 'fixture', pinned: false } });
    await act(async () => button('Load model options').click());
    // The effective options are shown, and the private values never are.
    expect(host.querySelector('[aria-label="Per-model saved and effective options"]')).not.toBeNull();
    expect(host.textContent).not.toContain('private'); expect(host.textContent).not.toContain('hidden');
    const textarea = host.querySelector('textarea')!; expect(JSON.parse(textarea.value)).toEqual({ ctx_size: 2048 });
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '{"ctx_size":8192}'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(calls).toContainEqual({ operation: 'save-model-options', model: 'fixture', options: { ctx_size: 8192 } });
    await act(async () => button('Reset to inherited defaults').click()); expect(textarea.value).toBe('{}');
    await act(async () => button('Check model file updates').click()); expect(calls.some((item) => item.operation === 'pull')).toBe(false);
    await act(async () => button('Download update for fixture').click()); expect(calls).toContainEqual({ operation: 'pull', input: { model_name: 'fixture', stream: true, subscribe: false } }); expect(changed).toBe(3);
  } finally { await act(async () => root.unmount()); host.remove(); fetchMock.mockRestore(); }
});

test('failed pin keeps both retry actions reachable without showing upstream details', async () => {
  const client = { base: '', token: async () => '', request: async () => { throw new Error('private-path'); }, json: async <T,>(): Promise<T> => { throw new Error('private-path'); } };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try { await act(async () => root.render(<LocalAiModelActions model="fixture" client={client} onChanged={async () => {}} onOptions={() => {}} />)); await act(async () => host.querySelector('button')!.click()); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.textContent).not.toContain('private-path'); expect([...host.querySelectorAll('button')].every((button) => !button.disabled)).toBe(true); }
  finally { await act(async () => root.unmount()); host.remove(); }
});
