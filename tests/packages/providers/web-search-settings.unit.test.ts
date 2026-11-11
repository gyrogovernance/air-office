import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebSearchSettings, WebSearchSettingsError } from '../../../packages/providers/src/web-search-settings.service';
import { createVaultWebSearchSettingsStore } from '../../../packages/providers/src/web-search-settings-vault.adapter';
import { createEndpointSearchProvider } from '../../../packages/providers/src/web-search.adapter';
import { createDdgsSearchProvider } from '../../../packages/providers/src/ddgs-search.adapter';
import { ensureVaultLayout } from '../../../packages/vault/src/vault.service.public';
import type { WebSearchProvider, WebSearchResponse } from '@office/contracts/capability';

/**
 * The search endpoint is a stored setting, so the person using the app can
 * point it at a search service they run. The stored-versus-effective
 * distinction matters here: a setting that is present but unusable must not
 * read as a working search.
 */
const harness = (builtIn?: WebSearchProvider | null) => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-search-'));
  process.env.AIR_VAULT_ROOT = scratch;
  ensureVaultLayout(scratch);
  const open: { close(): void }[] = [];
  const build = () => {
    const settings = createWebSearchSettings({
      store: createVaultWebSearchSettingsStore(scratch),
      createProvider: (endpoint) => { try { return createEndpointSearchProvider({ endpoint, id: 'searxng' }); } catch { return null; } },
      createBuiltInProvider: () => builtIn === undefined ? createDdgsSearchProvider({ command: [process.execPath] }) : builtIn
    });
    open.push(settings);
    return settings;
  };
  return { scratch, settings: build(), build, cleanup: () => { for (const handle of open) handle.close(); rmSync(scratch, { recursive: true, force: true }); } };
};

/** A provider that answers, used to stand in for a working engine. */
const answeringProvider = (results = 1): WebSearchProvider => ({
  id: 'test-engine',
  search: async (query: string): Promise<WebSearchResponse> => ({
    query,
    provider: 'test-engine',
    searchedAt: new Date().toISOString(),
    results: Array.from({ length: results }, (_, index) => ({ title: `Result ${index}`, url: `https://example.test/${index}`, snippet: 'A passage.' }))
  })
});

test('a startup endpoint seeds a new workspace without overriding the saved free choice on restart', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-search-seed-'));
  process.env.AIR_VAULT_ROOT = scratch;
  // Do not pre-create settings files: the first store open must apply the seed once.
  const first = createVaultWebSearchSettingsStore(scratch, 'http://127.0.0.1:8888/search');
  expect(first.read().endpoint).toBe('http://127.0.0.1:8888/search');
  first.write(null, {}, true);
  first.close();
  const restarted = createVaultWebSearchSettingsStore(scratch, 'http://127.0.0.1:8888/search');
  try { expect(restarted.read()).toMatchObject({ endpoint: null, enabled: true }); }
  finally { restarted.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('the built-in engine serves search when no address is set', () => {
  const { settings, cleanup } = harness();
  try {
    expect(settings.state()).toMatchObject({ configured: true, enabled: true, builtIn: true, provider: 'ddgs', endpoint: null });
    expect(settings.provider()?.id).toBe('ddgs');
  } finally { cleanup(); }
});

test('an address the user sets takes the place of the built-in engine', async () => {
  const { settings, cleanup } = harness();
  try {
    const saved = await settings.save({ endpoint: 'http://127.0.0.1:8888/search' });
    expect(saved).toMatchObject({ configured: true, builtIn: false, provider: 'searxng', endpoint: 'http://127.0.0.1:8888/search' });
    expect(settings.provider()?.id).toBe('searxng');
  } finally { cleanup(); }
});

test('clearing the address returns to the built-in engine rather than switching search off', async () => {
  const { settings, cleanup } = harness();
  try {
    await settings.save({ endpoint: 'http://127.0.0.1:8888/search' });
    const cleared = await settings.save({ endpoint: null });
    expect(cleared).toMatchObject({ configured: true, enabled: true, builtIn: true, provider: 'ddgs', endpoint: null });
    expect(settings.provider()?.id).toBe('ddgs');
  } finally { cleanup(); }
});

test('switching search off removes the provider without touching the address', async () => {
  const { settings, cleanup } = harness();
  try {
    await settings.save({ endpoint: 'http://127.0.0.1:8888/search' });
    const off = await settings.save({ enabled: false });
    expect(off).toMatchObject({ configured: false, enabled: false, endpoint: 'http://127.0.0.1:8888/search' });
    expect(settings.provider()).toBeNull();
    const on = await settings.save({ enabled: true });
    expect(on).toMatchObject({ configured: true, enabled: true, provider: 'searxng' });
  } finally { cleanup(); }
});

test('an address that cannot serve search is refused and not stored', async () => {
  const { settings, cleanup } = harness();
  try {
    await expect(settings.save({ endpoint: 'ftp://search.example' })).rejects.toThrow('http or https');
    await expect(settings.save({ endpoint: 'not an address' })).rejects.toThrow('http or https');
    expect(settings.state().endpoint).toBeNull();
    expect(settings.state().builtIn).toBe(true);
  } finally { cleanup(); }
});

test('a stored address is read back by a new service over the same workspace', async () => {
  const { settings, build, cleanup } = harness();
  try {
    await settings.save({ endpoint: 'http://127.0.0.1:8888/search' });
    const reopened = build();
    expect(reopened.state()).toMatchObject({ configured: true, provider: 'searxng', endpoint: 'http://127.0.0.1:8888/search' });
  } finally { cleanup(); }
});

test('the loader controls are stored and read back with their limits applied', async () => {
  const { settings, build, cleanup } = harness();
  try {
    await settings.save({ endpoint: 'http://127.0.0.1:8888/search', timeoutMs: 25_000, maxConcurrentRequests: 4, verifySsl: false, bypassWebLoader: true, trustProxyEnvironment: false });
    const stored = settings.state();
    expect(stored.timeoutMs).toBe(25_000);
    expect(stored.maxConcurrentRequests).toBe(4);
    expect(stored.verifySsl).toBe(false);
    expect(stored.bypassWebLoader).toBe(true);
    expect(stored.trustProxyEnvironment).toBe(false);
    // The controls survive a restart, because they are part of the setting.
    expect(build().state()).toMatchObject({ timeoutMs: 25_000, maxConcurrentRequests: 4, verifySsl: false });
  } finally { cleanup(); }
});

test('a loader control outside its limit is clamped rather than refused', async () => {
  const { settings, cleanup } = harness();
  try {
    const saved = await settings.save({ endpoint: 'http://127.0.0.1:8888/search', timeoutMs: 5, maxConcurrentRequests: 99 });
    expect(saved.timeoutMs).toBe(1000);
    expect(saved.maxConcurrentRequests).toBe(8);
  } finally { cleanup(); }
});

test('the search region defaults to worldwide and a chosen region survives a restart', async () => {
  const { settings, build, cleanup } = harness();
  try {
    // Worldwide by default: the engine's own default is a country, which would bias results.
    expect(settings.state().region).toBe('wt-wt');
    const saved = await settings.save({ region: 'uk-en' });
    expect(saved.region).toBe('uk-en');
    expect(build().state().region).toBe('uk-en');
    // A region that is not a region code falls back to worldwide rather than reaching the engine.
    const reset = await settings.save({ region: 'not a region' });
    expect(reset.region).toBe('wt-wt');
  } finally { cleanup(); }
});

test('an address that is not a string is refused with the invalid code', async () => {
  const { settings, cleanup } = harness();
  try {
    const error = await settings.save({ endpoint: 42 }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(WebSearchSettingsError);
    expect((error as WebSearchSettingsError).code).toBe('invalid');
  } finally { cleanup(); }
});

test('a check that reaches the engine reports the search as working', async () => {
  const { settings, cleanup } = harness(answeringProvider(2));
  try {
    const result = await settings.check();
    expect(result.reachable).toBe(true);
    expect(result.reason).toBe('ok');
    expect(settings.state().reachable).toBe(true);
  } finally { cleanup(); }
});

test('a check that cannot reach the engine says why and stays recorded', async () => {
  const failing: WebSearchProvider = { id: 'test-engine', search: async () => { throw new Error('Unable to connect. Is the computer able to access the url?'); } };
  const { settings, cleanup } = harness(failing);
  try {
    const result = await settings.check();
    expect(result.reachable).toBe(false);
    expect(result.reason).toBe('unreachable');
    expect(result.detail).toContain('Unable to connect');
    // The outcome survives, so the workspace can report it without asking again.
    expect(settings.state().reachable).toBe(false);
    expect(settings.state().reason).toBe('unreachable');
  } finally { cleanup(); }
});

test('an engine that answers with nothing is told apart from one that cannot be reached', async () => {
  const { settings, cleanup } = harness(answeringProvider(0));
  try {
    const result = await settings.check();
    expect(result.reachable).toBe(false);
    expect(result.reason).toBe('unreadable');
  } finally { cleanup(); }
});

test('search that is switched off is not checked', async () => {
  const { settings, cleanup } = harness(answeringProvider(2));
  try {
    await settings.save({ enabled: false });
    const result = await settings.check();
    expect(result.reachable).toBe(false);
    expect(result.reason).toBe('disabled');
  } finally { cleanup(); }
});
