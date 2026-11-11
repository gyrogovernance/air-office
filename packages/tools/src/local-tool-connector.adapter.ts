import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { LocalMcpConfiguration, ToolConnection, ToolDefinition } from '@office/contracts/tool';
import { isJsonSchema } from '@office/contracts/tool';
import type { ToolHandler } from './tools.domain.public';
import { validateConnection } from './tools.domain.public';

type CatalogId = LocalMcpConfiguration['catalogId'];
type Operation = { definition: ToolDefinition; handler: ToolHandler };
export const LOCAL_MCP_CATALOG = Object.freeze({
  'atomic-mail': Object.freeze({ packageName: '@atomicmail/mcp-github', version: '0.3.31', entrypoint: 'esm/mcp/main.js', credentialEnvironment: null }),
  resend: Object.freeze({ packageName: 'resend-mcp', version: '2.27.1', entrypoint: 'dist/index.js', credentialEnvironment: 'RESEND_API_KEY' }),
  'shopify-dev': Object.freeze({ packageName: '@shopify/dev-mcp', version: '1.17.0', entrypoint: 'dist/index.js', credentialEnvironment: null })
});

/** Trusted service composition only. Never populate these executable fields from imported connections. */
export type LocalMcpOptions = {
  installationDirectory: string;
  credentials: (connectionId: string) => Promise<string | null>;
  nodeExecutable?: string;
  npmCliPath?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
};

const safeEnvironment = (): Record<string, string> => Object.fromEntries(['PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'].flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));

/** Service-side transport primitive; every caller must obtain explicit start approval first. */
export async function createStdioMcpSession(options: { command: string; args: string[]; cwd?: string; env?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number; maxBufferBytes?: number }) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const transport = new StdioClientTransport({ command: options.command, args: options.args, cwd: options.cwd, env: { ...safeEnvironment(), ...options.env }, stderr: 'ignore', maxBufferSize: options.maxBufferBytes ?? 1_000_000 });
  const client = new Client({ name: 'AIR Office', version: '0.1.0' }, { listMaxPages: 16 });
  let closed = false;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closed = true;
    return closing ??= client.close();
  };
  const request = async <T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (closed) throw new Error('The local MCP process is stopped. Start it again from Tools settings.');
    const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
    const aborted = () => { void close().catch(() => undefined); };
    bounded.addEventListener('abort', aborted, { once: true });
    try {
      bounded.throwIfAborted();
      return await operation(bounded);
    } catch {
      await close();
      if (signal?.aborted) throw new Error('The local MCP operation was cancelled.');
      if (bounded.aborted) throw new Error('The local MCP operation timed out and its process was stopped.');
      throw new Error('The local MCP process failed or returned an unsupported response. Check its installation and credentials.');
    } finally { bounded.removeEventListener('abort', aborted); }
  };
  try { await request((signal) => client.connect(transport, { signal, timeout: timeoutMs }), options.signal); }
  catch (error) { await close(); throw error; }
  return {
    get pid() { return transport.pid; },
    get running() { return !closed && transport.pid !== null; },
    close,
    list: (signal?: AbortSignal) => request((bounded) => client.listTools(undefined, { signal: bounded, timeout: timeoutMs, cacheMode: 'bypass' }), signal),
    call: async (name: string, input: Record<string, unknown>, signal?: AbortSignal) => {
      const result = await request((bounded) => client.callTool({ name, arguments: input }, { signal: bounded, timeout: timeoutMs, toolDefinition: { name, inputSchema: { type: 'object' } } }), signal);
      if (result.isError) throw new Error('The local MCP tool reported an execution error.');
      return result;
    }
  };
}

type Session = Awaited<ReturnType<typeof createStdioMcpSession>>;

export function createLocalToolConnector(options: LocalMcpOptions) {
  const root = resolve(options.installationDirectory);
  const sessions = new Map<string, { catalogId: CatalogId; session: Session }>();
  const pending = new Map<string, AbortController>();
  const pendingDone = new Map<string, Promise<void>>();
  const finishPending = new Map<string, () => void>();
  const begin = (id: string, controller: AbortController) => {
    pending.set(id, controller);
    pendingDone.set(id, new Promise<void>((done) => finishPending.set(id, done)));
  };
  const finish = (id: string) => {
    pending.delete(id);
    finishPending.get(id)?.();
    finishPending.delete(id);
    pendingDone.delete(id);
  };
  let closed = false;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBufferBytes = options.maxBufferBytes ?? 1_000_000;
  const catalog = (connection: ToolConnection) => {
    if (!validateConnection(connection) || !connection.local) throw new Error('A valid curated local MCP connection is required.');
    return { id: connection.local.catalogId, descriptor: LOCAL_MCP_CATALOG[connection.local.catalogId] };
  };
  const runtime = () => {
    const command = options.nodeExecutable ?? Bun.which('node');
    if (!command || !existsSync(command)) throw new Error('Local MCP requires an installed Node.js runtime. The packaged AIR Office runtime does not include Node.js or npm.');
    return command;
  };
  const location = (id: CatalogId) => join(root, id);
  const installed = (id: CatalogId): boolean => {
    const item = LOCAL_MCP_CATALOG[id];
    try {
      const packageDirectory = join(location(id), 'node_modules', item.packageName);
      const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')) as { version?: string };
      return manifest.version === item.version && existsSync(join(packageDirectory, item.entrypoint));
    } catch { return false; }
  };
  const approved = (approval: { approved: true }) => {
    if (approval?.approved !== true) throw new Error('Explicit user approval is required to install or start a local MCP package.');
    if (closed) throw new Error('The local MCP connector is shut down.');
  };
  const stop = async (connectionId: string) => {
    pending.get(connectionId)?.abort();
    await pendingDone.get(connectionId);
    const entry = sessions.get(connectionId);
    sessions.delete(connectionId);
    await entry?.session.close();
  };
  return {
    status(connection: ToolConnection) {
      const { id } = catalog(connection);
      return { installed: installed(id), running: sessions.get(connection.id)?.session.running === true, package: `${LOCAL_MCP_CATALOG[id].packageName}@${LOCAL_MCP_CATALOG[id].version}` };
    },
    async install(connection: ToolConnection, approval: { approved: true }, signal?: AbortSignal): Promise<void> {
      approved(approval);
      const { id, descriptor } = catalog(connection);
      if (pending.size || [...sessions.values()].some((entry) => entry.catalogId === id)) throw new Error('Stop the local MCP process and wait for pending operations before installing.');
      const node = runtime();
      const npmCli = options.npmCliPath ?? join(dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (!existsSync(npmCli)) throw new Error('npm is unavailable. Install Node.js with npm or configure its service-side CLI path before installing local MCP packages.');
      const controller = new AbortController();
      begin(connection.id, controller);
      const bounded = AbortSignal.any([controller.signal, ...(signal ? [signal] : []), AbortSignal.timeout(120_000)]);
      try {
        bounded.throwIfAborted();
        mkdirSync(location(id), { recursive: true });
        await new Promise<void>((resolveInstall, reject) => {
          const child = spawn(node, [npmCli, 'install', '--prefix', location(id), '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', `${descriptor.packageName}@${descriptor.version}`], { shell: false, windowsHide: true, env: safeEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
          let bytes = 0;
          let failed = false;
          const terminate = () => { failed = true; child.kill('SIGKILL'); };
          bounded.addEventListener('abort', terminate, { once: true });
          const consume = (chunk: Buffer) => { bytes += chunk.byteLength; if (bytes > maxBufferBytes) terminate(); };
          child.stdout.on('data', consume);
          child.stderr.on('data', consume);
          child.once('error', () => { failed = true; });
          child.once('close', (code) => {
            bounded.removeEventListener('abort', terminate);
            if (failed || code !== 0 || bounded.aborted) reject(new Error('Local MCP installation failed, was cancelled, exceeded its output limit, or timed out. No process was started.'));
            else resolveInstall();
          });
          if (bounded.aborted) terminate();
        });
        if (!installed(id)) throw new Error('The pinned local MCP package entrypoint is unavailable after installation.');
      } finally { finish(connection.id); }
    },
    async start(connection: ToolConnection, approval: { approved: true }, signal?: AbortSignal): Promise<Operation[]> {
      approved(approval);
      const { id, descriptor } = catalog(connection);
      if (pending.size || sessions.has(connection.id)) throw new Error('A local MCP operation is already active. Stop it before starting again.');
      if (!installed(id)) throw new Error('Install the pinned local MCP package with user approval before starting it.');
      const command = runtime();
      const controller = new AbortController();
      begin(connection.id, controller);
      const bounded = AbortSignal.any([controller.signal, ...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
      let session: Session | undefined;
      try {
        const token = descriptor.credentialEnvironment ? await Promise.race([
          options.credentials(connection.id),
          new Promise<never>((_resolve, reject) => {
            if (bounded.aborted) reject(new Error('Local MCP startup was cancelled or timed out.'));
            else bounded.addEventListener('abort', () => reject(new Error('Local MCP startup was cancelled or timed out.')), { once: true });
          })
        ]) : null;
        bounded.throwIfAborted();
        if (descriptor.credentialEnvironment && !token) throw new Error('Store the local MCP API key in the system keychain before starting this connection.');
        session = await createStdioMcpSession({ command, args: [join(location(id), 'node_modules', descriptor.packageName, descriptor.entrypoint)], cwd: location(id), env: descriptor.credentialEnvironment && token ? { [descriptor.credentialEnvironment]: token } : {}, signal: bounded, timeoutMs, maxBufferBytes });
        const result = await session.list(bounded);
        if (result.tools.length > 500) throw new Error('The local MCP tool catalog exceeds the supported size.');
        const active = session;
        const operations = result.tools.map((tool): Operation => {
          if (!isJsonSchema(tool.inputSchema) || tool.inputSchema.type !== 'object') throw new Error(`The local MCP input schema for ${tool.name.slice(0, 64)} is unsupported.`);
          const name = tool.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64);
          if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name)) throw new Error('A local MCP tool name is unsupported.');
          return {
            definition: { id: `${connection.id}:${tool.name}`, connectionId: connection.id, name, description: (tool.description ?? name).slice(0, 2000), inputSchema: tool.inputSchema, effect: tool.annotations?.readOnlyHint === true && tool.annotations.destructiveHint !== true ? 'read' : 'mutate', enabled: false },
            handler: (input, abort) => active.call(tool.name, input, abort)
          };
        });
        bounded.throwIfAborted();
        sessions.set(connection.id, { catalogId: id, session });
        return operations;
      } catch (error) { await session?.close(); throw error; }
      finally { finish(connection.id); }
    },
    stop,
    async close() {
      closed = true;
      for (const controller of pending.values()) controller.abort();
      await Promise.all([...pendingDone.values()]);
      await Promise.all([...sessions.keys()].map(stop));
    }
  };
}
