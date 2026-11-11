import { afterAll, expect, test } from 'bun:test';
import type { KnowledgeWorkspaceState } from '../../../apps/web/src/knowledge/knowledge-workspace.hook';
import '../../support/web-dom.adapter';

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { KnowledgeEmbeddingSettings } = await import('../../../apps/web/src/knowledge/knowledge-embedding-settings.component');

test('embedding form preserves qualified upstream IDs and submits revision and dimensions together', async () => {
  const calls: unknown[][] = [];
  const knowledge = { embeddingModel: 'org:embedding', embeddingRevision: 'recipe-123', embeddingDimensions: 2, embeddingMode: 'demo', setEmbeddingModel: async (...args: unknown[]) => { calls.push(args); }, refresh: async () => {} } as unknown as KnowledgeWorkspaceState;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<KnowledgeEmbeddingSettings knowledge={knowledge} models={[{ value: 'managed-local:org:embedding', label: 'Embedding model', roles: ['embedding'] }]} />));
    expect((host.querySelector('[aria-label="Knowledge embedding model"]') as HTMLButtonElement).textContent).toContain('Embedding model');
    expect(host.textContent).toContain('demo');
    await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent === 'Index options')!.click(); });
    expect((host.querySelector('[aria-label="Knowledge embedding revision"]') as HTMLInputElement).value).toBe('recipe-123');
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(calls).toEqual([['org:embedding', 2, 'recipe-123', '', { inputTokenLimit: 512, rerankTokenLimit: 512 }]]);
    expect((host.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('empty embedding list offers the model browser instead of a broken form', async () => {
  const opened: string[] = [];
  const knowledge = { embeddingModel: '', embeddingRevision: '', embeddingDimensions: 0, setEmbeddingModel: async () => {}, refresh: async () => {} } as unknown as KnowledgeWorkspaceState;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<KnowledgeEmbeddingSettings knowledge={knowledge} models={[]} onOpenLocalAi={() => opened.push('local-ai')} />));
    expect(host.textContent).toContain('needs a local embedding model');
    expect(host.querySelector('form')).toBeNull();
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Browse models in Market')!.click());
    expect(opened).toEqual(['local-ai']);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('saving failures retain draft values and restore the save control', async () => {
  const knowledge = { embeddingModel: 'embed', embeddingRevision: 'revision', embeddingDimensions: 2, setEmbeddingModel: async () => { throw new Error('Runtime unavailable'); }, refresh: async () => {} } as unknown as KnowledgeWorkspaceState;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<KnowledgeEmbeddingSettings knowledge={knowledge} models={[{ value: 'managed-local:embed', label: 'embed', roles: ['embedding'] }]} />));
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect((host.querySelector('[aria-label="Knowledge embedding model"]') as HTMLButtonElement).textContent).toContain('embed');
    await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent === 'Index options')!.click(); });
    expect((host.querySelector('[aria-label="Knowledge embedding revision"]') as HTMLInputElement).value).toBe('revision');
    expect((host.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});


test('one-click indexing default probes the installed embedding model and saves complete settings', async () => {
  const saved: unknown[][] = [];
  const probes: string[] = [];
  const knowledge = { embeddingModel: '', embeddingRevision: '', embeddingDimensions: 0,
    probeEmbeddingModel: async (model: string) => { probes.push(model); return { dimensions: 384 }; },
    setEmbeddingModel: async (...args: unknown[]) => { saved.push(args); }, refresh: async () => {},
  } as unknown as KnowledgeWorkspaceState;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<KnowledgeEmbeddingSettings knowledge={knowledge} models={[{ value: 'managed-local:local-embed', label: 'Local embedding', roles: ['embedding'], revision: 'recipe-1' }]} />));
    // Auto-adopt runs on mount when indexing is unconfigured; wait for that save.
    for (let attempt = 0; attempt < 20 && saved.length === 0; attempt += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    expect(probes).toEqual(['local-embed']);
    expect(saved).toEqual([['local-embed', 384, 'recipe-1', '']]);
    expect(host.querySelector('details')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
