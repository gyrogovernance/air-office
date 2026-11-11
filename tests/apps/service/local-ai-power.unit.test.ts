import { expect, test } from 'bun:test';
import { createLocalAiPowerRoutes } from '../../../apps/service/src/local-ai-power.route';
import { createLocalInferenceControl } from '@office/runtime/service';

const fixtureDescriptor = {
  instanceId: 'attached-runtime',
  generation: 4,
  release: '2026.42.1',
  baseOrigin: 'http://127.0.0.1:4318',
  resolveSecret: () => 'fixture-token'
};

test('turning Local AI off on an attached runtime does not control the runtime process', async () => {
  const control = createLocalInferenceControl();
  control.setEnabled(true);
  let disabled = 0;
  let upstreamRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async () => {
    upstreamRequests++;
    return Response.json({});
  }, { preconnect: () => undefined }) as typeof fetch;
  try {
    const route = createLocalAiPowerRoutes({
      control,
      getDescriptor: () => fixtureDescriptor,
      owned: () => false,
      onDisabled: () => { disabled++; }
    });

    const response = await route(new Request('http://127.0.0.1/api/v1/local-ai/power', {
      method: 'PUT',
      body: JSON.stringify({ enabled: false })
    }), new URL('http://127.0.0.1/api/v1/local-ai/power'));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ available: true, enabled: false, stopping: false });
    expect(disabled).toBe(1);
    expect(upstreamRequests).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('owned Local AI power-off disables inference immediately and unloads in the background', async () => {
  const control = createLocalInferenceControl();
  control.setEnabled(true);
  let disabled = 0;
  let resumeUnload: (() => void) | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
    const path = input instanceof Request ? input.url : String(input);
    if (path.includes('/v1/jobs')) return Response.json([]);
    if (path.includes('/v1/unload')) {
      await new Promise<void>((resolve) => { resumeUnload = resolve; });
      return Response.json({});
    }
    if (path.includes('/v1/health')) return Response.json({ all_models_loaded: [] });
    return Response.json({});
  }, { preconnect: () => undefined }) as typeof fetch;
  try {
    const route = createLocalAiPowerRoutes({
      control,
      getDescriptor: () => ({
        instanceId: 'owned-runtime',
        generation: 1,
        release: '2026.42.1',
        baseOrigin: 'http://127.0.0.1:4318',
        resolveSecret: () => 'fixture-token'
      }),
      owned: () => true,
      onDisabled: () => { disabled++; }
    });

    for (let attempt = 0; attempt < 40 && !resumeUnload; attempt++) await Bun.sleep(25);
    expect(resumeUnload).toBeTruthy();

    const response = await route(new Request('http://127.0.0.1/api/v1/local-ai/power', {
      method: 'PUT',
      body: JSON.stringify({ enabled: false })
    }), new URL('http://127.0.0.1/api/v1/local-ai/power'));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ available: true, enabled: false, stopping: true });
    expect(control.enabled()).toBe(false);
    expect(disabled).toBe(1);

    const blocked = await route(new Request('http://127.0.0.1/api/v1/local-ai/power', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true })
    }), new URL('http://127.0.0.1/api/v1/local-ai/power'));
    expect(blocked?.status).toBe(409);
    expect(control.enabled()).toBe(false);

    resumeUnload!();
    for (let attempt = 0; attempt < 80; attempt++) {
      const status = await (await route(new Request('http://127.0.0.1/api/v1/local-ai/power'), new URL('http://127.0.0.1/api/v1/local-ai/power')))!.json() as { stopping: boolean; enabled: boolean; error?: string };
      if (!status.stopping) {
        expect(status).toMatchObject({ available: true, enabled: false });
        expect(status.error).toBeUndefined();
        return;
      }
      await Bun.sleep(25);
    }
    throw new Error('Local AI unload did not finish.');
  } finally {
    (resumeUnload as (() => void) | null)?.();
    globalThis.fetch = originalFetch;
  }
});

test('owned unload failures stay actionable after Local AI is already off', async () => {
  const control = createLocalInferenceControl();
  control.setEnabled(true);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
    const path = input instanceof Request ? input.url : String(input);
    if (path.includes('/v1/jobs')) return Response.json([]);
    if (path.includes('/v1/unload')) throw new TypeError('Failed to fetch');
    return Response.json({});
  }, { preconnect: () => undefined }) as typeof fetch;
  try {
    const route = createLocalAiPowerRoutes({
      control,
      getDescriptor: () => ({
        instanceId: 'owned-runtime',
        generation: 2,
        release: '2026.42.1',
        baseOrigin: 'http://127.0.0.1:4318',
        resolveSecret: () => 'fixture-token'
      }),
      owned: () => true,
      onDisabled: () => undefined
    });

    const response = await route(new Request('http://127.0.0.1/api/v1/local-ai/power', {
      method: 'PUT',
      body: JSON.stringify({ enabled: false })
    }), new URL('http://127.0.0.1/api/v1/local-ai/power'));
    expect(response?.status).toBe(200);
    expect(control.enabled()).toBe(false);

    for (let attempt = 0; attempt < 40; attempt++) {
      const status = await (await route(new Request('http://127.0.0.1/api/v1/local-ai/power'), new URL('http://127.0.0.1/api/v1/local-ai/power')))!.json() as { stopping: boolean; enabled: boolean; error?: string };
      if (!status.stopping) {
        expect(status.enabled).toBe(false);
        expect(status.error).toContain('unreachable');
        expect(status.error).not.toBe('Failed to fetch');
        return;
      }
      await Bun.sleep(25);
    }
    throw new Error('Local AI unload did not finish.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
