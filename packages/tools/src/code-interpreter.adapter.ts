import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface CodeExecutionRequest {
  code: string;
  language?: string;
  timeoutMs?: number;
}

export interface CodeExecutionResult {
  status: 'succeeded' | 'failed' | 'timeout' | 'cancelled';
  stdout: string;
  stderr: string;
  /** True when output hit the byte cap; the process was killed and the text is partial. */
  truncated: boolean;
  exitCode: number | null;
  durationMs: number;
}

export interface CodeInterpreterOptions {
  /** Interpreter executable. Defaults to the runtime running this process. */
  runtime?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Base directory for per-run temporary folders; defaults to the operating system temp directory. */
  workRoot?: string;
}

export type CodeInterpreter = ReturnType<typeof createCodeInterpreter>;

/**
 * The environment handed to a snippet carries no service configuration, so
 * provider credentials in the service environment never reach snippet code.
 * Each run gets a fresh temp directory, a wall-clock timeout, and output caps;
 * that contains accidental runaway but is not an OS network or filesystem jail,
 * so a snippet runs with the same host access as any local code the operator
 * chose to execute.
 */
function sandboxEnv(directory: string): Record<string, string> {
  const env: Record<string, string> = { TEMP: directory, TMP: directory };
  if (process.env.PATH) env.PATH = process.env.PATH;
  const systemRoot = process.env.SYSTEMROOT ?? process.env.SystemRoot;
  if (process.platform === 'win32' && systemRoot) env.SYSTEMROOT = systemRoot;
  return env;
}

export function createCodeInterpreter(options: CodeInterpreterOptions = {}) {
  const runtime = options.runtime ?? process.execPath;
  const defaultTimeoutMs = options.timeoutMs ?? 10_000;
  const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
  return {
    async execute(request: CodeExecutionRequest, signal?: AbortSignal): Promise<CodeExecutionResult> {
      if ((request.language ?? 'javascript').toLowerCase() !== 'javascript') throw new Error('This interpreter runs JavaScript snippets only.');
      if (!request.code.trim()) throw new Error('Provide a code snippet to run.');
      const timeoutMs = Math.min(Math.max(Math.trunc(request.timeoutMs ?? defaultTimeoutMs), 100), 60_000);
      const started = Date.now();
      const directory = mkdtempSync(join(options.workRoot ?? tmpdir(), 'air-code-'));
      let timedOut = false;
      try {
        writeFileSync(join(directory, 'snippet.mjs'), request.code, 'utf8');
        const child = Bun.spawn([runtime, join(directory, 'snippet.mjs')], { cwd: directory, env: sandboxEnv(directory), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
        const onAbort = () => { clearTimeout(timer); child.kill(); };
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
        const collect = async (stream: ReadableStream<Uint8Array> | null): Promise<{ text: string; truncated: boolean }> => {
          if (!stream) return { text: '', truncated: false };
          const reader = stream.getReader();
          const decoder = new TextDecoder();
          let text = '';
          let bytes = 0;
          let truncated = false;
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            const remaining = maxOutputBytes - bytes;
            const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
            bytes += chunk.byteLength;
            text += decoder.decode(chunk, { stream: true });
            if (chunk.byteLength < value.byteLength) {
              truncated = true;
              child.kill();
              break;
            }
          }
          return { text: text + decoder.decode(), truncated };
        };
        let output: { stdout: string; stderr: string; truncated: boolean; exitCode: number | null };
        try {
          const [out, err, exitCode] = await Promise.all([collect(child.stdout), collect(child.stderr), child.exited]);
          output = { stdout: out.text, stderr: err.text, truncated: out.truncated || err.truncated, exitCode };
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        }
        const status: CodeExecutionResult['status'] = timedOut ? 'timeout' : signal?.aborted ? 'cancelled' : output.exitCode === 0 ? 'succeeded' : 'failed';
        return { status, ...output, durationMs: Date.now() - started };
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  };
}
