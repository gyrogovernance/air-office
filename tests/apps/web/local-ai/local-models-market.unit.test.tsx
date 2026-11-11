import { afterAll, expect, spyOn, test } from 'bun:test';
import '../../../support/web-dom.adapter';

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { LocalModelsMarket } = await import('../../../../apps/web/src/models/local-ai/local-models-market.component');
const { createServiceClient } = await import('../../../../apps/web/src/shared/service-client.hook');
const { AppDialogsProvider, useAppDialogs } = await import('../../../../apps/web/src/shared/app-dialogs.component');

type Fixture = { source?: 'runtime' | 'bundled'; online?: boolean; backend?: string; installed?: boolean; failPull?: boolean; failDownloads?: boolean; demo?: boolean; useInChat?: boolean };
async function market(fixture: Fixture = {}) {
  let installed = fixture.installed ?? false;
  let backend = fixture.backend ?? 'installed';
  let setup = 0;
  let selectedModel = '';
  let confirmation: { title: string; message: string; confirmLabel?: string } | null = null;
  let approveConfirmation: (() => void) | undefined;
  const operations: Record<string, unknown>[] = [];
  const mocked = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'session' });
    if (path === '/api/v1/model-catalog/computer') return Response.json({ processor: 'Fixture CPU', memory: '16 GB' });
    if (path === '/api/v1/model-catalog') return Response.json({ source: fixture.source ?? 'runtime', release: '2026.42.1', models: [
      { id: 'Qwen chat', recipe: 'llamacpp', labels: ['chat'], sizeGB: 1.5, downloaded: installed, suggested: true },
      { id: 'Search encoder', recipe: 'llamacpp', labels: ['embeddings'], sizeGB: 0.3, downloaded: false, suggested: true },
    ] });
    if (path === '/api/v1/local-ai/status') return fixture.online === false ? Response.json({ error: 'Unavailable' }, { status: 503 }) : Response.json({ state: 'ready', systemInfo: { demo: fixture.demo ?? false, Processor: 'Fixture CPU', 'Physical Memory': '16 GB', recipes: { llamacpp: { backends: { cpu: { state: backend, devices: ['cpu'] } } } } }, health: { all_models_loaded: [{ model_name: 'Qwen chat' }] } });
    if (path === '/api/v1/local-ai/operations') {
      const operation = JSON.parse(String(init?.body)); operations.push(operation);
      if (operation.operation === 'system-info') return fixture.online === false ? Response.json({ error: 'Unavailable' }, { status: 503 }) : Response.json({ result: { Processor: 'Fixture CPU', 'Physical Memory': '64 GB', devices: { nvidia_gpu: [{ name: 'Fixture graphics', available: true, vram_gb: 16 }], amd_npu: { name: 'Fixture NPU', available: true } }, recipes: { llamacpp: { backends: { cpu: { state: backend, devices: ['cpu'] } } } } } });
      if (operation.operation === 'downloads') return fixture.failDownloads ? Response.json({ error: 'private upstream details' }, { status: 503 }) : Response.json({ result: [] });
      if (operation.operation === 'pull') {
        if (fixture.failPull) return Response.json({ error: 'private upstream details' }, { status: 503 });
        installed = true;
      }
      if (operation.operation === 'install') backend = 'installed';
      if (operation.operation === 'registry-search') return Response.json({ result: { results: [{ repository_id: 'org/chat', display_name: 'Community chat' }] } });
      if (operation.operation === 'variants') return Response.json({ result: { checkpoint: 'org/chat', recipe: 'llamacpp', suggested_name: 'community-chat', suggested_labels: ['chat'], variants: [{ name: 'Q4_K_M', size_bytes: 1000000000 }] } });
      return Response.json({ result: {} });
    }
    throw new Error(`Unexpected request ${path}`);
  }, { preconnect: fetch.preconnect }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  function DialogHarness({ children }: { children: React.ReactNode }) {
    const dialogs = useAppDialogs();
    dialogs.confirm = (options) => new Promise<boolean>((resolve) => { confirmation = options; approveConfirmation = () => resolve(true); });
    return <>{children}</>;
  }
  await act(async () => root.render(<AppDialogsProvider><DialogHarness><LocalModelsMarket client={createServiceClient('http://127.0.0.1:4317')} onSetup={() => setup++} onUseModel={fixture.useInChat ? (model) => { selectedModel = model; } : undefined} /></DialogHarness></AppDialogsProvider>));
  return {
    host, operations, setup: () => setup, selectedModel: () => selectedModel, confirmation: () => confirmation,
    approveConfirmation: async () => { await act(async () => approveConfirmation?.()); },
    buttons: (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.textContent === label),
    search: async (query: string) => { await act(async () => { const input = host.querySelector<HTMLInputElement>('[aria-label="Search models"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, query); input.dispatchEvent(new Event('input', { bubbles: true })); }); },
    close: async () => { await act(async () => root.unmount()); host.remove(); mocked.mockRestore(); },
  };
}

function expectBrowseOnly(host: HTMLElement) {
  expect(host.querySelector('h2')).toBeNull();
  expect(host.querySelector('[aria-label="Detected model locations"]')).toBeNull();
  expect(host.textContent).not.toMatch(/Lemonade|Runtime|Engine ready|Local AI is offline|live catalog is unavailable/i);
  const labels = [...host.querySelectorAll('button')].map((button) => button.textContent);
  // An installed model may be deleted, so 'Delete' is a legitimate row
  // action. What must not appear are the runtime management actions that
  // belong to a different application, and the delete confirmation itself.
  for (const label of ['Load', 'Unload', 'Options', 'Pin', 'Unpin', 'Model options', 'Delete model...']) expect(labels).not.toContain(label);
  expect(host.querySelector('[aria-label="Confirm model name"]')).toBeNull();
}

test('an installed chat model can be selected directly from Market', async () => {
  const view = await market({ installed: true, useInChat: true });
  try {
    await act(async () => view.buttons('Use in chat')[0]!.click());
    expect(view.selectedModel()).toBe('Qwen chat');
    expect(view.setup()).toBe(0);
  } finally { await view.close(); }
});

test('offline browsing keeps search usable, downloads disabled and setup reachable without warnings', async () => {
  const view = await market({ online: false, source: 'bundled' });
  try {
    expectBrowseOnly(view.host);
    expect(view.host.querySelectorAll('.model-catalog-row')).toHaveLength(2);
    expect(view.host.textContent).not.toContain('Suggested models');
    expect(view.host.textContent).not.toContain('44.8 GB');
    expect(view.buttons('Download')).toHaveLength(2);
    expect(view.buttons('Download').every((button) => button.disabled)).toBe(true);
    await view.search('encoder');
    expect(view.host.querySelectorAll('.model-catalog-row')).toHaveLength(1);
    expect(view.host.querySelector('.model-catalog-row')?.textContent).toContain('Search encoder');
    expect(view.host.textContent).not.toContain('Fixture CPU');
    expect(view.buttons('Check compatibility')[0]?.disabled).toBe(false);
    expect(view.host.textContent).not.toContain('Suggested models');
    await act(async () => view.buttons('Check compatibility')[0]!.click());
    expect(view.host.textContent).not.toContain('Fixture CPU');
    expect(view.host.querySelector('[role="alert"]')?.textContent).toBe('Compatibility could not be checked. Try again.');
    expect(view.setup()).toBe(0);
    expect(view.operations).toEqual([{ operation: 'system-info' }]);
  } finally { await view.close(); }
});

test('downloads preserve the configured service operation and installed rows only link to model settings', async () => {
  const view = await market();
  try {
    expectBrowseOnly(view.host);
    expect(view.host.textContent).toContain('Hardware compatibility');
    expect(view.host.textContent).toContain('Fixture CPU');
    expect(view.host.textContent).toContain('16 GB');
    expect(view.buttons('Check compatibility')[0]?.disabled).toBe(false);
    await act(async () => view.buttons('Download')[0]!.click());
    expect(view.operations).toContainEqual({ operation: 'pull', input: { model_name: 'Qwen chat', stream: true, subscribe: false } });
    expect(view.operations.slice(view.operations.findIndex((operation) => operation.operation === 'pull') + 1)).toContainEqual({ operation: 'downloads' });
    expect(view.host.querySelector('.model-catalog-row')?.textContent).toContain('Installed');
    expectBrowseOnly(view.host);
    await act(async () => view.buttons('Model settings')[0]!.click());
    expect(view.setup()).toBe(1);
    expect(view.operations.every((operation) => ['downloads', 'pull'].includes(String(operation.operation)))).toBe(true);
    await act(async () => view.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(view.host.querySelectorAll('.model-catalog-row')).toHaveLength(1);
  } finally { await view.close(); }
});

test('deleting an installed model asks for confirmation and then removes it', async () => {
  const view = await market({ installed: true });
  try {
    const remove = view.host.querySelector<HTMLButtonElement>('[aria-label="Delete model Qwen chat"]');
    expect(remove).not.toBeNull();
    await act(async () => remove!.click());
    expect(view.confirmation()).toMatchObject({ title: 'Delete model', message: expect.stringContaining('Delete "Qwen chat"?'), confirmLabel: 'Delete model' });
    expect(view.operations.some((operation) => operation.operation === 'delete')).toBe(false);
    await view.approveConfirmation();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(view.operations).toContainEqual({ operation: 'delete', input: { model_name: 'Qwen chat' } });
  } finally { await view.close(); }
});

test('download setup preserves the selected recipe and backend before model download', async () => {
  const view = await market({ backend: 'installable' });
  try {
    await act(async () => view.buttons('Download')[0]!.click());
    expect(view.operations).toContainEqual({ operation: 'install', input: { recipe: 'llamacpp', backend: 'cpu', stream: false } });
    expect(view.operations).toContainEqual({ operation: 'pull', input: { model_name: 'Qwen chat', stream: true, subscribe: false } });
    expect(view.host.textContent).not.toContain('Download support installed');
    expect(view.buttons('Set up download')).toHaveLength(0);
  } finally { await view.close(); }
});

test('repository search and variant downloads retain their existing service payloads', async () => {
  const view = await market();
  try {
    await view.search('community');
    await act(async () => view.buttons('Search repositories for “community”')[0]!.click());
    expect(view.operations).toContainEqual({ operation: 'registry-search', input: { query: 'community', format: 'gguf' } });
    await act(async () => view.buttons('Choose variant')[0]!.click());
    await act(async () => view.buttons('Download Q4_K_M')[0]!.click());
    expect(view.operations).toContainEqual({ operation: 'pull', input: { model_name: 'user.community-chat', recipe: 'llamacpp', checkpoint: 'org/chat:Q4_K_M', stream: true, subscribe: false } });
  } finally { await view.close(); }
});

test('background download inspection failures stay quiet while requested failures are actionable', async () => {
  const view = await market({ failDownloads: true, failPull: true });
  try {
    expect(view.host.querySelector('[role="alert"]')).toBeNull();
    await act(async () => view.buttons('Download')[0]!.click());
    expect(view.host.querySelector('[role="alert"]')?.textContent).toBe('Could not download Qwen chat. Try again.');
    expect(view.host.textContent).not.toContain('private upstream');
    expect(view.buttons('Download').every((button) => !button.disabled)).toBe(true);
  } finally { await view.close(); }
});

test('bundled fallback while connected preserves browsing without claiming download readiness', async () => {
  const view = await market({ source: 'bundled' });
  try {
    expectBrowseOnly(view.host);
    expect(view.host.querySelector('[role="alert"]')).toBeNull();
    expect(view.buttons('Download').every((button) => button.disabled)).toBe(true);
    expect(view.buttons('Check compatibility')[0]?.disabled).toBe(false);
  } finally { await view.close(); }
});

test('demo hardware stays explicitly labelled and unsupported model downloads remain disabled', async () => {
  const view = await market({ demo: true, backend: 'unsupported' });
  try {
    expect(view.host.textContent).toContain('Demo hardware');
    expect(view.host.textContent).toContain('Not supported on this hardware');
    expect(view.buttons('Download').every((button) => button.disabled)).toBe(true);
    expect(view.operations.some((operation) => operation.operation === 'pull')).toBe(false);
  } finally { await view.close(); }
});
