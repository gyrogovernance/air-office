import { expect, test } from 'bun:test';
import '../../../support/web-dom.adapter';

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { GlassScene } = await import('@glass-sdk/liquid-glass');
const { LocalAiPower } = await import('../../../../apps/web/src/models/local-ai/local-ai-power.component');

function client(handlers: { get?: () => Promise<unknown> | unknown; put?: (enabled: boolean) => Promise<unknown> | unknown }) {
  return {
    base: 'http://127.0.0.1:4317',
    token: async () => 'fixture',
    request: async () => new Response(null, { status: 204 }),
    json: async <T,>(path: string, init?: RequestInit) => {
      if (path !== '/api/v1/local-ai/power') throw new Error(`unexpected path ${path}`);
      if ((init?.method ?? 'GET') === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { enabled?: boolean };
        return await handlers.put?.(Boolean(body.enabled)) as T;
      }
      return await handlers.get?.() as T;
    },
  };
}

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  return {
    host,
    async render(content: React.ReactNode) {
      await act(async () => root.render(<GlassScene appearance="light" material="regular" maxSurfaces={4}>{content}</GlassScene>));
      await act(async () => undefined);
    },
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test('Local AI power turns off immediately and does not float a network-failure popup', async () => {
  const view = mount(null);
  let enabled = true;
  let putCalls = 0;
  try {
    await view.render(<LocalAiPower client={client({
      get: () => ({ available: true, enabled, stopping: false }),
      put: async (next) => {
        putCalls += 1;
        enabled = next;
        throw new TypeError('Failed to fetch');
      },
    })} />);
    const control = view.host.querySelector('[aria-label="Local AI"]') as HTMLElement;
    expect(control).toBeTruthy();
    await act(async () => control.click());
    expect(putCalls).toBe(1);
    expect(view.host.querySelector('[data-enabled="true"]')).toBeNull();
    expect(view.host.textContent).not.toContain('Local AI did not respond');
    expect(view.host.textContent).not.toContain('Failed to fetch');
    expect(view.host.querySelector('.local-ai-power-error')).toBeNull();
  } finally {
    await view.unmount();
  }
});

test('Local AI power recovers server truth after a failed toggle when status remains readable', async () => {
  const view = mount(null);
  try {
    await view.render(<LocalAiPower client={client({
      get: () => ({ available: true, enabled: true, stopping: false }),
      put: async () => { throw new Error('Wait for Local AI to finish stopping.'); },
    })} />);
    const control = view.host.querySelector('[aria-label="Local AI"]') as HTMLElement;
    await act(async () => control.click());
    expect(view.host.querySelector('[data-enabled="true"]')).not.toBeNull();
    expect(view.host.textContent).toContain('Wait for Local AI to finish stopping.');
  } finally {
    await view.unmount();
  }
});
