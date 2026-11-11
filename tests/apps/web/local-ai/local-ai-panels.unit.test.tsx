import { afterAll, expect, test } from 'bun:test';
import '../../../support/web-dom.adapter';

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { LocalAiPanels } = await import('../../../../apps/web/src/models/local-ai/local-ai-panels.component');

test('advanced controls have one maintenance owner and state-aware job rows without JSON requests', async () => {
  const calls: Record<string, unknown>[] = [];
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const operation = async (value: Record<string, unknown>) => {
    calls.push(value);
    if (value.operation === 'jobs') return { jobs: [{ id: 'running-job', name: 'Current benchmark', status: 'running' }, { id: 'paused-job', name: 'Paused benchmark', status: 'paused' }, { id: 'done-job', name: 'Finished benchmark', status: 'completed' }] };
    if (value.operation === 'aliases') return { aliases: [{ alias: 'research', target: 'org/model:Q4' }] };
    if (value.operation === 'installed-models') return { data: [{ id: 'org/model:Q4', labels: ['tool-calling'] }] };
    return { max_loaded_models: 2 };
  };
  try {
    await act(async () => root.render(<LocalAiPanels operation={operation} />));
    expect(host.querySelector('nav')).toBeNull();
    expect(host.querySelectorAll('[aria-label="Local runtime updates"]')).toHaveLength(1);
    const jobRows = [...host.querySelectorAll('li')];
    const running = jobRows.find((row) => row.textContent?.includes('Current benchmark'))!;
    expect([...running.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Pause', 'Interrupt']);
    await act(async () => running.querySelector('button')!.click());
    expect(calls).toContainEqual({ operation: 'job-control', id: 'running-job', action: 'pause' });
    const paused = [...host.querySelectorAll('li')].find((row) => row.textContent?.includes('Paused benchmark'))!;
    await act(async () => paused.querySelector('button')!.click());
    expect(calls).toContainEqual({ operation: 'job-control', id: 'paused-job', action: 'resume' });
    const alias = [...host.querySelectorAll('li')].find((row) => row.textContent?.includes('research'))!;
    await act(async () => alias.querySelector('button')!.click());
    expect((host.querySelector('input[pattern]') as HTMLInputElement).value).toBe('research');
    const form = host.querySelector('form')!;
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(calls).toContainEqual({ operation: 'add-alias', input: { alias: 'research', model_name: 'org/model:Q4' } });
    expect(host.textContent).not.toContain('Job request JSON');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('failed alias save retains its own draft and does not expose upstream errors', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const operation = async (value: Record<string, unknown>) => {
    if (value.operation === 'aliases') return { aliases: [{ alias: 'research', target: 'model' }] };
    if (value.operation === 'add-alias') throw new Error('C:/private/secret');
    return [];
  };
  try {
    await act(async () => root.render(<LocalAiPanels operation={operation} />));
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Edit')!.click());
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect((host.querySelector('input[pattern]') as HTMLInputElement).value).toBe('research');
    expect(host.textContent).toContain('Your draft is kept');
    expect(host.textContent).not.toContain('C:/private');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
