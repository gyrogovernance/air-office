import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProtectedCredentialStore } from '../../../packages/providers/src/protected-credential.adapter';

function directory() {
  return mkdtempSync(join(tmpdir(), 'air-office-protected-cred-'));
}

test('protected credentials round-trip oversized OAuth records without returning them through presence checks', async () => {
  const root = directory();
  try {
    const store = createProtectedCredentialStore({ directory: root });
    const secret = JSON.stringify({
      version: 1,
      accessToken: `access-${'a'.repeat(900)}`,
      refreshToken: `refresh-${'b'.repeat(900)}`,
      idToken: `id-${'c'.repeat(900)}`
    });
    expect(Buffer.byteLength(secret, 'utf16le')).toBeGreaterThan(2560);
    await store.store('chatgpt-account-demo', secret);
    expect(await store.resolve('chatgpt-account-demo')).toBe(secret);
    const path = join(root, `${Buffer.from('chatgpt-account-demo').toString('base64url')}.cred`);
    expect(readFileSync(path, 'utf8')).toBe(secret);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(await store.forget('chatgpt-account-demo')).toBe('removed');
    expect(await store.resolve('chatgpt-account-demo')).toBeNull();
    expect(await store.forget('chatgpt-account-demo')).toBe('absent');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('protected credential ids cannot escape the private directory and store failures omit the secret', async () => {
  const root = directory();
  try {
    const store = createProtectedCredentialStore({ directory: root });
    await expect(store.store('../escape', 'secret-value')).rejects.toThrow('invalid');
    await expect(store.resolve('a/b')).rejects.toThrow('invalid');
    let message = '';
    try { await store.store('', 'never-logged-secret'); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    expect(message).toContain('invalid');
    expect(message).not.toContain('never-logged-secret');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('forgetAll removes only credential files from the private directory', async () => {
  const root = directory();
  try {
    const store = createProtectedCredentialStore({ directory: root });
    await store.store('one', 'secret-one');
    await store.store('two', 'secret-two');
    expect(await store.forgetAll()).toEqual({ removed: 2, failed: [] });
    expect(await store.resolve('one')).toBeNull();
    expect(await store.resolve('two')).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
