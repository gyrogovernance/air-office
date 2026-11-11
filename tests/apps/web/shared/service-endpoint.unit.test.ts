import { afterEach, expect, spyOn, test } from 'bun:test';
import { demoServiceBase, developmentServiceBase, devSupervisorBase, ensureServiceReachable, resetServiceDiscovery, serviceSessionEpoch, waitForDevelopmentService } from '../../../../apps/web/src/shared/service-endpoint.hook';

function enableDemoMode() {
  const previous = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      __officeDemoForTests: true,
      localStorage: {
        getItem: (key: string) => key === 'office.development.demo' ? 'on' : null,
        setItem() { /* test stub */ },
        removeItem() { /* test stub */ }
      },
      location: { origin: 'http://127.0.0.1:5173' }
    }
  });
  return () => Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: previous });
}

function serviceHarness() {
  let ready = false;
  let startAvailable = true;
  let starts = 0;
  const restoreWindow = enableDemoMode();
  const requests: Array<{ url: string; method: string }> = [];
  const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? 'GET' });
    if (url === `${demoServiceBase}/health`) return Response.json({ ready, demo: ready });
    if (url === `${devSupervisorBase}/demo/start` && init?.method === 'POST') {
      starts++;
      await Promise.resolve();
      if (!startAvailable) return Response.json({ error: 'Unavailable' }, { status: 503 });
      ready = true;
      return Response.json({ base: demoServiceBase });
    }
    throw new Error(`Unexpected request ${url}`);
  }, { preconnect: fetch.preconnect }));
  return {
    requests,
    get starts() { return starts; },
    stop() { ready = false; },
    setStartAvailable(value: boolean) { startAvailable = value; },
    restore() { mock.mockRestore(); restoreWindow(); resetServiceDiscovery(); }
  };
}

let harness: ReturnType<typeof serviceHarness> | undefined;
afterEach(() => { harness?.restore(); harness = undefined; });

test('requests resume the selected workspace after each development restart', async () => {
  harness = serviceHarness();
  for (let run = 0; run < 2; run++) {
    harness.stop();
    const endpoints = await Promise.all(Array.from({ length: 4 }, () => ensureServiceReachable(demoServiceBase)));
    expect(endpoints).toEqual(Array(4).fill('http://127.0.0.1:4329'));
    expect(harness.starts).toBe(run + 1);
  }
});

test('a failed start can be retried once development is available again', async () => {
  harness = serviceHarness();
  harness.setStartAvailable(false);
  await expect(ensureServiceReachable(demoServiceBase)).rejects.toThrow();
  harness.setStartAvailable(true);
  expect(await ensureServiceReachable(demoServiceBase)).toBe('http://127.0.0.1:4329');
  expect(harness.starts).toBe(2);
});

test('the personal workspace does not start optional services', async () => {
  // No Demo override: personal workspace must not hit the Demo supervisor.
  const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL) => {
    throw new Error(`Unexpected request ${String(input)}`);
  }, { preconnect: fetch.preconnect }));
  try {
    expect(await ensureServiceReachable(developmentServiceBase)).toBe(developmentServiceBase);
  } finally {
    mock.mockRestore();
  }
});

test('waitForDevelopmentService polls until health and bootstrap succeed', async () => {
  let healthCalls = 0;
  let boots = 0;
  const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/health')) {
      healthCalls += 1;
      return Response.json({ ready: healthCalls > 1 });
    }
    if (url.endsWith('/bootstrap') && init?.method === 'POST') {
      boots += 1;
      return Response.json({ token: 't', serviceBase: developmentServiceBase });
    }
    throw new Error(`Unexpected ${url}`);
  }, { preconnect: fetch.preconnect }));
  try {
    expect(await waitForDevelopmentService(developmentServiceBase, 5_000)).toBe(developmentServiceBase);
    expect(healthCalls).toBeGreaterThan(1);
    expect(boots).toBe(1);
  } finally {
    mock.mockRestore();
    resetServiceDiscovery();
  }
});

test('waitForDevelopmentService fails loud when the service never becomes ready', async () => {
  const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => Response.json({ ready: false }), { preconnect: fetch.preconnect }));
  try {
    await expect(waitForDevelopmentService(developmentServiceBase, 400)).rejects.toThrow(/did not become ready/);
  } finally {
    mock.mockRestore();
    resetServiceDiscovery();
  }
});

test('resetServiceDiscovery bumps the session epoch so clients drop stale tokens', () => {
  const before = serviceSessionEpoch();
  resetServiceDiscovery();
  expect(serviceSessionEpoch()).toBe(before + 1);
});
