import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalToolConnector, createStdioMcpSession } from '../../../packages/tools/src/local-tool-connector.adapter';
import { createSqliteToolStore } from '../../../packages/tools/src/tool-store.adapter';
import { validateConnection } from '../../../packages/tools/src/tools.domain.public';
import type { ToolConnection } from '@office/contracts/tool';

const fixture = new URL('../../support/stdio-mcp-fixture.entry.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const launch = (timeoutMs = 2000, maxBufferBytes = 10000) => createStdioMcpSession({ command: process.execPath, args: [fixture], timeoutMs, maxBufferBytes, env: { RESEND_API_KEY: 'fixture-key' } });
const connection: ToolConnection = { id: 'local', name: 'Resend', kind: 'mcp', endpoint: null, enabled: true, discoveredAt: null, local: { catalogId: 'resend' } };

describe('local MCP lifecycle', () => {
  test('uses a real child for initialization, discovery, credentials, calls and shutdown', async () => {
    const session = await launch();
    const pid = session.pid;
    try {
      expect(pid).toBeNumber();
      expect((await session.list()).tools[0]?.name).toBe('echo');
      expect(await session.call('echo', {})).toMatchObject({ content: [{ text: 'fixture-key' }] });
      expect(await session.call('echo', { text: 'working' })).toMatchObject({ content: [{ text: 'working' }] });
      let failure = '';
      try { await session.call('fail', {}); } catch (error) { failure = String(error); }
      expect(failure).toContain('execution error');
    } finally { await session.close(); }
    expect(session.running).toBe(false);
    expect(() => process.kill(pid!, 0)).toThrow();
  });

  test('cancellation stops the process and stale handlers cannot restart it', async () => {
    const session = await launch();
    const abort = new AbortController();
    const pending = session.call('hang', {}, abort.signal);
    abort.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(session.running).toBe(false);
    await expect(session.call('echo', {})).rejects.toThrow('stopped');
  });

  test('timeout and excessive unterminated output stop the child', async () => {
    const session = await launch(1500);
    await expect(session.call('hang', {})).rejects.toThrow('timed out');
    expect(session.running).toBe(false);
    const oversized = await launch();
    await expect(oversized.call('overflow', {})).rejects.toThrow();
    expect(oversized.running).toBe(false);
  }, 15000);

  test('preserves old SQLite records and roundtrips optional curated configuration without launch', () => {
    const directory = mkdtempSync(join(tmpdir(), 'air-tools-'));
    const path = join(directory, 'tools.sqlite');
    let store = createSqliteToolStore(path);
    try {
      const { local: _local, ...legacy } = connection;
      store.saveConnection({ ...legacy, id: 'legacy', endpoint: 'https://example.com/mcp' });
      store.saveConnection(connection);
      store.close();
      store = createSqliteToolStore(path);
      expect(store.connections()).toEqual([{ ...legacy, id: 'legacy', endpoint: 'https://example.com/mcp' }, connection]);
      expect(validateConnection({ ...connection, local: { catalogId: 'resend', command: 'unsafe' } })).toBe(false);
    } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  test('requires separate explicit install/start approval and reports unavailable installation', async () => {
    const connector = createLocalToolConnector({ installationDirectory: join(tmpdir(), crypto.randomUUID()), credentials: async () => null });
    expect(connector.status(connection)).toMatchObject({ installed: false, running: false });
    await expect(connector.start(connection, { approved: false } as never)).rejects.toThrow('approval');
    await expect(connector.start(connection, { approved: true })).rejects.toThrow('Install');
    await connector.close();
  });
});
