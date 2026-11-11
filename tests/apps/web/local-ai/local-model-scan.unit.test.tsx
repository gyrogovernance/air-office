import { afterAll, expect, test } from 'bun:test';
import { createElement } from 'react';
import '../../../support/web-dom.adapter';


const { act, StrictMode } = await import('react');
const { createRoot } = await import('react-dom/client');
const { LocalModelScan } = await import('../../../../apps/web/src/models/local-ai/local-model-scan.component');
const { AppDialogsProvider } = await import('../../../../apps/web/src/shared/app-dialogs.component');

type ScanStatus = {
  locations: { id: string; name: string; path: string; extra: boolean; available: boolean }[];
  models: { id: string; name: string; path: string; format: string; role?: 'chat' | 'embedding' | 'rerank'; size: number; issue?: string; importedModel?: string }[];
  engines: { id: string; name: string; kind: string; version: string | null; path: string; running: boolean; port: number | null; installed?: boolean; builds?: string[] }[];
  canImport: boolean;
  scannedAt: string | null;
  warnings: string[];
};

const status: ScanStatus = {
  locations: [{ id: 'ollama', name: 'Ollama', path: 'C:/models', extra: false, available: true }],
  models: [
    { id: 'imported', name: 'Qwen chat', path: 'C:/models/chat.gguf', format: 'GGUF', role: 'chat', size: 1024, importedModel: 'user.imported-chat' },
    { id: 'plain', name: 'Local embedding', path: 'C:/models/embed.gguf', format: 'GGUF', role: 'embedding', size: 512 },
  ],
  engines: [{ id: 'ollama', name: 'Ollama', kind: 'ollama', version: '0.5.7', path: 'http://127.0.0.1:11434', running: true, port: 11434 }],
  canImport: true,
  scannedAt: '2026-10-21T00:00:00.000Z',
  warnings: [],
};

function client(requests: { action: string; id?: string }[], next: ScanStatus = status) {
  return {
    base: 'http://127.0.0.1:4317',
    token: async () => 'test-token',
    async json<T>(_path: string, init?: RequestInit): Promise<T> {
      if (_path === '/api/v1/model-harness') return { models: [] } as T;
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { action: string; id?: string };
        requests.push({ action: body.action, id: body.id });
      }
      return next as T;
    },
    async request(_path: string, _init?: RequestInit) { return Response.json(next); },
  };
}

test('an imported chat model can save its full harness preference', async () => {
  const requests: unknown[] = [];
  const base = client([]);
  const modelClient = { ...base, async json<T>(path: string, init?: RequestInit): Promise<T> {
    if (path === '/api/v1/model-harness') {
      if (init?.method === 'PUT') {
        const preference = JSON.parse(String(init.body));
        requests.push(preference);
        return { preference } as T;
      }
      return { models: [] } as T;
    }
    return base.json<T>(path, init);
  } };
  const view = await mount(createElement(LocalModelScan, { client: modelClient, onImported: async () => {} }));
  try {
    const row = [...view.host.querySelectorAll('[aria-label="Detected models"] li')].find((item) => item.textContent?.includes('Qwen chat'));
    const checkbox = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) throw new Error('Imported chat model must offer the setting.');
    await act(async () => { checkbox.click(); });
    expect(requests).toEqual([{ providerId: 'managed-local', modelId: 'user.imported-chat', fullHarness: true }]);
  } finally { await view.finish(); }
});

async function mount(node: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(StrictMode, null, createElement(AppDialogsProvider, null, node))); });
  return { host, async finish() { await act(async () => root.unmount()); host.remove(); } };
}

test('the scan shows the walkthrough and the engine builds it found', async () => {
  const requests: { action: string; id?: string }[] = [];
  const next: ScanStatus = { ...status, engines: [...status.engines, { id: 'llama.cpp', name: 'llama.cpp', kind: 'llama.cpp', version: null, path: 'C:/tools/llama-server.exe', running: false, port: null, installed: true }] };
  const view = await mount(createElement(LocalModelScan, { client: client(requests, next), onImported: async () => {} }));
  try {
    // The walkthrough, the found builds and the detected models each have their
    // own region, so a test can find them without matching their wording.
    expect(view.host.querySelector('[aria-label="How to set up local models"]')).not.toBeNull();
    expect(view.host.querySelector('[aria-label="Engine builds"]')).not.toBeNull();
    expect(view.host.querySelector('[aria-label="Detected models"]')).not.toBeNull();
    expect(view.host.querySelector('[aria-label="Engine builds"]')?.textContent).toContain('C:/tools/llama-server.exe');
  } finally { await view.finish(); }
});

test('choosing an engine build asks the service to use it', async () => {
  const requests: { action: string; id?: string }[] = [];
  const next: ScanStatus = { ...status, engines: [...status.engines, { id: 'llama.cpp', name: 'llama.cpp', kind: 'llama.cpp', version: null, path: 'C:/tools/llama-server.exe', running: false, port: null, installed: true }] };
  const view = await mount(createElement(LocalModelScan, { client: client(requests, next), onImported: async () => {} }));
  try {
    const button = [...view.host.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === 'Use this build');
    if (!button) throw new Error('The use build action must render.');
    await act(async () => { button.click(); });
    expect(requests.some((request) => request.action === 'use-engine')).toBe(true);
  } finally { await view.finish(); }
});

test('an imported model offers a remove action and a plain model offers a remove action', async () => {
  const requests: { action: string; id?: string }[] = [];
  const view = await mount(createElement(LocalModelScan, { client: client(requests), onImported: async () => {}, onUseModel: () => {} }));
  try {
    expect(view.host.querySelector('[aria-label="Remove model Qwen chat"]')).not.toBeNull();
    expect(view.host.querySelector('[aria-label="Remove model Local embedding from the list"]')).not.toBeNull();
    // Each detected model states the purpose it serves and the engine it runs on.
    const rows = [...view.host.querySelectorAll('[aria-label="Detected models"] li')];
    expect(rows.length).toBe(status.models.length);
    expect(rows.every((row) => /Runs on /.test(row.textContent ?? ''))).toBe(true);
  } finally { await view.finish(); }
});

test('confirming the removal sends the delete action for that model', async () => {
  const requests: { action: string; id?: string }[] = [];
  const view = await mount(createElement(LocalModelScan, { client: client(requests), onImported: async () => {} }));
  try {
    const button = view.host.querySelector<HTMLButtonElement>('[aria-label="Remove model Qwen chat"]');
    if (!button) throw new Error('The remove action must render.');
    await act(async () => { button.click(); });
    const confirm = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === 'Remove model');
    if (!confirm) throw new Error('The confirmation must render.');
    await act(async () => { confirm.click(); });
    expect(requests).toContainEqual({ action: 'delete', id: 'imported' });
  } finally { await view.finish(); }
});

test('cancelling the removal sends nothing', async () => {
  const requests: { action: string; id?: string }[] = [];
  const view = await mount(createElement(LocalModelScan, { client: client(requests), onImported: async () => {} }));
  try {
    const button = view.host.querySelector<HTMLButtonElement>('[aria-label="Remove model Qwen chat"]');
    if (!button) throw new Error('The remove action must render.');
    await act(async () => { button.click(); });
    const cancel = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === 'Cancel');
    if (!cancel) throw new Error('The cancel action must render.');
    await act(async () => { cancel.click(); });
    expect(requests.filter((request) => request.action === 'delete')).toHaveLength(0);
  } finally { await view.finish(); }
});
