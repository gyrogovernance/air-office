import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { KeychainRunner } from './keychain-credentials.adapter';

export function createNativeKeychainRunner(executable: string | undefined): KeychainRunner & { close(): void } {
  let child: ChildProcessWithoutNullStreams | undefined;
  let queue = Promise.resolve();
  const request = (action: string, service: string, account: string, secret?: string) => {
    const pending = queue.then(() => new Promise<{ code: number; secret?: string }>((resolve, reject) => {
      if (!executable) { reject(new Error('The native credential helper is unavailable.')); return; }
      if (!child || child.exitCode !== null || child.killed) {
        child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] });
        child.stdout.setEncoding('utf8');
        child.stderr.resume();
        child.stdin.on('error', () => undefined);
      }
      const process = child;
      let buffer = '';
      const finish = (error?: Error, result?: { code: number; secret?: string }) => {
        clearTimeout(timer);
        process.stdout.off('data', onData);
        process.off('error', onError);
        process.off('exit', onExit);
        if (error) { process.kill(); child = undefined; reject(error); }
        else resolve(result ?? { code: 1 });
      };
      const onError = () => finish(new Error('Native credential access failed.'));
      const onExit = () => finish(new Error('The native credential helper stopped.'));
      const onData = (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 65_536) { onError(); return; }
        if (!buffer.endsWith('\n')) return;
        try {
          const value: unknown = JSON.parse(buffer);
          if (!value || typeof value !== 'object' || !('code' in value) || typeof value.code !== 'number' || ![0, 1, 2].includes(value.code)) throw new Error();
          const secret = 'secret' in value && typeof value.secret === 'string' ? value.secret : undefined;
          finish(undefined, { code: value.code, secret });
        } catch { onError(); }
      };
      const timer = setTimeout(() => finish(new Error('Native credential access timed out.')), 10_000);
      process.once('error', onError);
      process.once('exit', onExit);
      process.stdout.on('data', onData);
      process.stdin.write(JSON.stringify({ action, service, account, ...(secret === undefined ? {} : { secret }) }) + '\n');
    }));
    queue = pending.then(() => undefined, () => undefined);
    return pending;
  };
  return {
    close: () => { child?.stdin.end(); child = undefined; },
    read: async (service, account) => {
      const result = await request('read', service, account);
      if (result.code === 2) return null;
      if (result.code !== 0) throw new Error('The saved credential could not be read from the system keychain.');
      return result.secret ?? null;
    },
    exists: async (service, account) => {
      try { const result = await request('exists', service, account); return result.code === 0 ? true : result.code === 2 ? false : 'unknown'; }
      catch { return 'unknown'; }
    },
    write: async (service, account, secret) => (await request('write', service, account, secret)).code === 0,
    forget: async (service, account) => {
      const result = await request('delete', service, account);
      return result.code === 2 ? 'absent' : result.code === 0;
    }
  };
}
