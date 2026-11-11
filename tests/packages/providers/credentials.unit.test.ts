import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEnvironmentCredentials, hasConfiguredCredential } from '../../../packages/providers/src/environment-credentials.adapter';
import { createCredentialStore, createKeychainCredentials, createPlatformKeychainRunner, type KeychainRunner } from '../../../packages/providers/src/keychain-credentials.adapter';

test('environment credentials resolve by provider id and never invent a value', async () => {
  const credentials = createEnvironmentCredentials({ OFFICE_PROVIDER_OPENAI_TOKEN: 'secret-token' });
  expect(await credentials.resolve('openai')).toBe('secret-token');
  expect(await credentials.resolve('ollama')).toBeNull();
  expect(hasConfiguredCredential({ OFFICE_PROVIDER_OPENAI_TOKEN: 'secret-token' }, 'openai')).toBe(true);
  expect(hasConfiguredCredential({}, 'openai')).toBe(false);
});

test('a settings check reports presence without exposing the value', () => {
  const reportsPresenceOnly = hasConfiguredCredential({ OFFICE_PROVIDER_ANTHROPIC_TOKEN: 'sk-live-secret' }, 'anthropic');
  expect(reportsPresenceOnly).toBe(true);
  expect(String(reportsPresenceOnly)).not.toContain('sk-live-secret');
});

test('keychain credentials resolve on demand and treat an empty read as no credential', async () => {
  const reads: [string, string][] = [];
  const runner: KeychainRunner = {
    read: async (service, account) => { reads.push([service, account]); return account === 'ollama' ? '' : 'from-keychain'; },
    exists: async () => false,
    write: async () => true,
    forget: async () => true
  };
  const credentials = createKeychainCredentials({ runner });
  expect(await credentials.resolve('openai')).toBe('from-keychain');
  expect(await credentials.resolve('ollama')).toBeNull();
  expect(reads).toEqual([['air-office/provider', 'openai'], ['air-office/provider', 'ollama']]);
});

test('the credential store reports presence, stores, and forgets without returning a secret', async () => {
  const entries = new Map<string, string>();
  const runner: KeychainRunner = {
    read: async (service, account) => entries.get(`${service}:${account}`) ?? null,
    exists: async (service, account) => entries.has(`${service}:${account}`),
    write: async (service, account, secret) => { entries.set(`${service}:${account}`, secret); return true; },
    forget: async (service, account) => entries.delete(`${service}:${account}`) ? true : 'absent'
  };
  const store = createCredentialStore({ runner });
  expect(await store.configured('openai')).toBe(false);
  await store.store('openai', 'sk-stored-secret');
  expect(await store.configured('openai')).toBe(true);
  const presence: unknown = await store.configured('openai');
  expect(JSON.stringify(presence)).not.toContain('sk-stored-secret');
  expect(await store.forget('openai')).toBe('removed');
  expect(await store.configured('openai')).toBe(false);
});

test('a failed keychain removal is reported and is not cached as absent', async () => {
  let present = true;
  const runner: KeychainRunner = { read: async () => null, exists: async () => present, write: async () => true, forget: async () => present ? false : 'absent' };
  const store = createCredentialStore({ runner });
  expect(await store.forget('openai')).toBe('failed');
  // The entry may still be stored, so presence stays true rather than flipping to absent.
  expect(await store.configured('openai')).toBe(true);
  present = false;
  expect(await store.forget('openai')).toBe('absent');
});

test('a failed keychain write surfaces as an error that does not contain the secret', async () => {
  const runner: KeychainRunner = { read: async () => null, exists: async () => false, write: async () => false, forget: async () => true };
  const store = createCredentialStore({ runner });
  let message = '';
  try {
    await store.store('openai', 'sk-never-logged');
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toContain('keychain');
  expect(message).not.toContain('sk-never-logged');
});

test('environment presence keeps a configured token reported after a keychain delete', async () => {
  let present = true;
  const runner: KeychainRunner = { read: async () => null, exists: async () => present, write: async () => true, forget: async () => { present = false; return true; } };
  const store = createCredentialStore({ runner, additionalPresence: async () => true });
  expect(await store.configured('openai')).toBe(true);
  await store.forget('openai');
  expect(await store.configured('openai')).toBe(true);
});

test('Linux credential writes keep secret values out of arguments', async () => {
  const calls: { args: string[]; stdin?: string }[] = [];
  const runner = createPlatformKeychainRunner('linux', async (_command, args, stdin) => { calls.push({ args, stdin }); return { code: 0, stdout: '' }; });
  await runner.write('air-office/provider', 'fixture', 'disposable-secret');
  expect(calls[0]?.stdin).toBe('disposable-secret');
  expect(calls[0]?.args.join(' ')).not.toContain('disposable-secret');
});

test('missing native helper reports unknown presence without launching a shell', async () => {
  const { createNativeKeychainRunner } = await import('../../../packages/providers/src/native-keychain.adapter');
  const runner = createNativeKeychainRunner(undefined);
  expect(await runner.exists('air-office/provider', 'fixture')).toBe('unknown');
  await expect(runner.read('air-office/provider', 'fixture')).rejects.toThrow('unavailable');
  runner.close();
});

test('Windows without a credentials bridge uses a private file vault when a directory is provided', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createProtectedKeychainRunner, createPlatformKeychainRunner: platformRunner } = await import('../../../packages/providers/src/keychain-credentials.adapter');
  const root = mkdtempSync(join(tmpdir(), 'air-cred-file-'));
  try {
    const previousUrl = process.env.OFFICE_CREDENTIALS_BRIDGE_URL;
    const previousToken = process.env.OFFICE_CREDENTIALS_BRIDGE_TOKEN;
    const previousNative = process.env.OFFICE_NATIVE_CREDENTIALS;
    delete process.env.OFFICE_CREDENTIALS_BRIDGE_URL;
    delete process.env.OFFICE_CREDENTIALS_BRIDGE_TOKEN;
    delete process.env.OFFICE_NATIVE_CREDENTIALS;
    try {
      const runner = platformRunner('win32', async () => ({ code: 1, stdout: '' }), { fileDirectory: root });
      expect(await runner.write('air-office/provider', 'openai', 'sk-dev-secret')).toBe(true);
      expect(await runner.exists('air-office/provider', 'openai')).toBe(true);
      expect(await runner.read('air-office/provider', 'openai')).toBe('sk-dev-secret');
      expect(await createProtectedKeychainRunner(root).read('air-office/provider', 'openai')).toBe('sk-dev-secret');
    } finally {
      if (previousUrl === undefined) delete process.env.OFFICE_CREDENTIALS_BRIDGE_URL;
      else process.env.OFFICE_CREDENTIALS_BRIDGE_URL = previousUrl;
      if (previousToken === undefined) delete process.env.OFFICE_CREDENTIALS_BRIDGE_TOKEN;
      else process.env.OFFICE_CREDENTIALS_BRIDGE_TOKEN = previousToken;
      if (previousNative === undefined) delete process.env.OFFICE_NATIVE_CREDENTIALS;
      else process.env.OFFICE_NATIVE_CREDENTIALS = previousNative;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Windows without bridge or file vault returns empty reads instead of throwing', async () => {
  const previousUrl = process.env.OFFICE_CREDENTIALS_BRIDGE_URL;
  const previousToken = process.env.OFFICE_CREDENTIALS_BRIDGE_TOKEN;
  const previousNative = process.env.OFFICE_NATIVE_CREDENTIALS;
  delete process.env.OFFICE_CREDENTIALS_BRIDGE_URL;
  delete process.env.OFFICE_CREDENTIALS_BRIDGE_TOKEN;
  delete process.env.OFFICE_NATIVE_CREDENTIALS;
  try {
    const runner = createPlatformKeychainRunner('win32', async () => ({ code: 1, stdout: '' }));
    expect(await runner.read('air-office/provider', 'openai')).toBeNull();
    expect(await runner.exists('air-office/provider', 'openai')).toBe(false);
    expect(await runner.write('air-office/provider', 'openai', 'sk')).toBe(false);
  } finally {
    if (previousUrl === undefined) delete process.env.OFFICE_CREDENTIALS_BRIDGE_URL;
    else process.env.OFFICE_CREDENTIALS_BRIDGE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.OFFICE_CREDENTIALS_BRIDGE_TOKEN;
    else process.env.OFFICE_CREDENTIALS_BRIDGE_TOKEN = previousToken;
    if (previousNative === undefined) delete process.env.OFFICE_NATIVE_CREDENTIALS;
    else process.env.OFFICE_NATIVE_CREDENTIALS = previousNative;
  }
});

test('credentials bridge runner talks JSON over loopback', async () => {
  const { createCredentialsBridgeRunner } = await import('../../../packages/providers/src/credentials-bridge.adapter');
  const previousUrl = process.env.OFFICE_CREDENTIALS_BRIDGE_URL;
  const previousToken = process.env.OFFICE_CREDENTIALS_BRIDGE_TOKEN;
  process.env.OFFICE_CREDENTIALS_BRIDGE_URL = 'http://127.0.0.1:9';
  process.env.OFFICE_CREDENTIALS_BRIDGE_TOKEN = 'test-token';
  try {
    const runner = createCredentialsBridgeRunner();
    await expect(runner.read('air-office/provider', 'fixture')).rejects.toThrow();
    runner.close();
  } finally {
    if (previousUrl === undefined) delete process.env.OFFICE_CREDENTIALS_BRIDGE_URL;
    else process.env.OFFICE_CREDENTIALS_BRIDGE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.OFFICE_CREDENTIALS_BRIDGE_TOKEN;
    else process.env.OFFICE_CREDENTIALS_BRIDGE_TOKEN = previousToken;
  }
});
