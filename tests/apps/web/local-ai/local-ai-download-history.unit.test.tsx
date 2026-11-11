import { afterAll, expect, test } from 'bun:test';
import type { ServiceClient } from '../../../../apps/web/src/shared/service-client.hook';
import '../../../support/web-dom.adapter';


const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { LocalAiDownloadHistory } = await import('../../../../apps/web/src/models/local-ai/local-ai-download-history.component');

test('history renders durable runtime identity and a manual refresh action', async () => {
  let reads = 0;
  const client = { json: async (path: string) => {
    expect(path).toBe('/api/v1/local-ai/download-history');
    reads++;
    return { activities: [{ id: 'activity', instanceId: 'owned', generation: 3, jobId: 'model:small', kind: 'model', state: reads > 1 ? 'completed' : 'interrupted', percent: 35, running: null, observedAt: '2026-10-17T00:00:00Z', lastAction: 'pause' }] };
  } } as ServiceClient;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<LocalAiDownloadHistory client={client} />));
    // Each recorded download shows its state, its generation and its progress.
    const entry = host.querySelector('[aria-label="Recorded Local AI downloads"] li');
    expect(entry).not.toBeNull();
    expect(entry?.textContent).toContain('interrupted');
    expect(entry?.textContent).toContain('generation 3');
    expect(entry?.textContent).toContain('35%');
    expect(entry?.textContent).toContain('Last requested action: pause');
    await act(async () => host.querySelector('button')!.click());
    expect(reads).toBe(2); expect(host.querySelector('[aria-label="Recorded Local AI downloads"] li')?.textContent).toContain('completed');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
