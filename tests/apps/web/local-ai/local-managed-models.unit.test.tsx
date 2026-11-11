import { afterAll, expect, test } from 'bun:test';
import { createElement } from 'react';
import '../../../support/web-dom.adapter';


const { act, StrictMode } = await import('react');
const { createRoot } = await import('react-dom/client');
const { LocalManagedModels } = await import('../../../../apps/web/src/models/local-ai/local-managed-models.component');
const { AppDialogsProvider } = await import('../../../../apps/web/src/shared/app-dialogs.component');
const systemInfo = { recipes: { llamacpp: { backends: { cpu: { state: 'installed', message: '' }, vulkan: { state: 'installable', message: 'Backend is supported but not installed.' } } } } };

function client(requests: { path: string; body: unknown }[], models: { id: string; name: string; role: string; recipe: string }[]) {
  return {
    base: 'http://127.0.0.1:4317',
    token: async () => 'test-token',
    async json<T>(path: string, init?: RequestInit): Promise<T> {
      if (init?.method === 'POST') requests.push({ path, body: JSON.parse(String(init.body)) as unknown });
      if (path.endsWith('/model-scan') && !init?.method) return { managedModels: [...models] } as T;
      if (path.endsWith('/operations')) return { result: { saved: { llamacpp_backend: 'cpu' }, effective: { llamacpp_backend: 'cpu' } } } as T;
      return {} as T;
    },
    async request(_path: string, _init?: RequestInit) { return Response.json({}); },
  };
}

async function mount(node: React.ReactNode) {
  // Another test file may have torn the document down, and the popup the
  // engine chooser opens needs one.
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(StrictMode, null, createElement(AppDialogsProvider, null, node))); });
  return { host, async finish() { await act(async () => root.unmount()); host.remove(); } };
}

test('a model the runtime holds is listed with the engine it runs on', async () => {
  const requests: { path: string; body: unknown }[] = [];
  const view = await mount(createElement(LocalManagedModels, { client: client(requests, [{ id: 'Bonsai-1.7B-gguf', name: 'Bonsai-1.7B-gguf', role: 'chat', recipe: 'llamacpp' }]), systemInfo, onChanged: async () => {} }));
  try {
    expect(view.host.querySelector('[aria-label="Downloaded models"]')).not.toBeNull();
    expect(view.host.textContent).toContain('Bonsai-1.7B-gguf');
    expect(view.host.querySelector('[aria-label="Engine for Bonsai-1.7B-gguf"]')).not.toBeNull();
  } finally { await view.finish(); }
});

test('downloaded models appear after the model inventory changes', async () => {
  const models: { id: string; name: string; role: string; recipe: string }[] = [];
  const view = await mount(createElement(LocalManagedModels, { client: client([], models), systemInfo, onChanged: async () => {} }));
  try {
    models.push({ id: 'local-chat', name: 'Local chat', role: 'chat', recipe: 'llamacpp' });
    await act(async () => { window.dispatchEvent(new Event('office-models-changed')); });
    expect(view.host.textContent).toContain('Local chat');
  } finally { await view.finish(); }
});

test('the engine chooser offers every engine the model can run on', async () => {
  const requests: { path: string; body: unknown }[] = [];
  const view = await mount(createElement(LocalManagedModels, { client: client(requests, [{ id: 'Bonsai-1.7B-gguf', name: 'Bonsai-1.7B-gguf', role: 'chat', recipe: 'llamacpp' }]), systemInfo, onChanged: async () => {} }));
  try {
    const trigger = view.host.querySelector<HTMLElement>('[aria-label="Engine for Bonsai-1.7B-gguf"]');
    if (!trigger) throw new Error('The engine chooser must render.');
    await act(async () => { trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    // The popup opens on the next tick, and a busy machine can take longer.
    for (let attempt = 0; attempt < 20 && !document.querySelector('[role="option"]'); attempt++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    const items = [...document.querySelectorAll('[role="option"]')].map((item) => item.textContent?.trim() ?? '');
    expect(items).toContain('CPU');
    expect(items.some((item) => item.startsWith('Vulkan'))).toBe(true);
  } finally { await view.finish(); }
});
