import { afterEach, expect, test } from 'bun:test';
import '../../support/web-dom.adapter';
const { act, createElement, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MarketKnowledgeCatalog } = await import('../../../apps/web/src/market/market-knowledge-catalog.component');
import type { KnowledgeCatalogEntry } from '../../../apps/web/src/market/market-knowledge-catalog.component';
const base = { collectionId: 'evaluation', collectionName: 'Evaluation', category: 'Evaluation', publisher: 'Research institute', edition: '2026', rights: 'MIT', rightsUrl: 'https://example.com/license', mediaType: 'text/markdown', installed: false };
const entries: KnowledgeCatalogEntry[] = [
  { ...base, id: 'datasets', title: 'Datasets', filename: 'data.md', description: 'Prepare samples', sourceUrl: 'https://example.com/datasets' },
  { ...base, collectionId: 'scoring', collectionName: 'Scoring guide', id: 'metrics', title: 'Metrics', filename: 'metrics.md', description: 'Estimate uncertainty', sourceUrl: 'javascript:alert(1)' },
  { ...base, category: 'AI governance', id: 'existing', title: 'Existing reference', filename: 'existing.md', description: 'Already in Knowledge', installed: true, sourceUrl: 'https://example.com/existing' },
];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const installed: string[][] = [];
async function mount() {
  installed.length = 0;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  function Harness() {
    const [selected, setSelected] = useState<string[]>([]);
    return createElement(MarketKnowledgeCatalog, { feed: { id: 'test', name: 'Test', description: 'Test', lastError: null, entries }, busy: false, selected, onSelectionChange: setSelected, onInstall: (chosen: KnowledgeCatalogEntry[]) => installed.push(chosen.map((entry) => entry.id)) });
  }
  await act(async () => root.render(createElement(Harness)));
}
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); });
async function filter(query: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('bulk selection accumulates across searches and never installs already added documents', async () => {
  await mount();
  await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Select Datasets"]')!.click());
  await filter('uncertainty');
  expect(host.querySelectorAll('.knowledge-document')).toHaveLength(1);
  await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Select visible documents not added"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('.market-add-button')!.click());
  expect(installed).toEqual([['datasets', 'metrics']]);
  await filter('');
  expect(host.querySelector<HTMLInputElement>('[aria-label="Select Existing reference"]')!.disabled).toBe(true);
});

test('source details expose HTTPS provenance but do not turn untrusted schemes into links', async () => {
  await mount();
  const rows = host.querySelectorAll('.knowledge-document');
  expect(rows[0]!.querySelector<HTMLAnchorElement>('.knowledge-document-copy a')!.href).toBe('https://example.com/datasets');
  expect([...rows[1]!.querySelectorAll('a')].some((link) => link.href.startsWith('javascript:'))).toBe(false);
});

 test('groups different collections by category and separates governance from evaluation', async () => {
  await mount();
  expect(host.querySelector('[aria-label="Evaluation"]')?.textContent).toContain('Metrics');
  expect(host.querySelector('[aria-label="Evaluation"]')?.textContent).not.toContain('Existing reference');
  expect(host.querySelector('[aria-label="AI governance"]')?.textContent).toContain('Existing reference');
});
