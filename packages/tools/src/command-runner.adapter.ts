import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';
import { isAbsolute } from 'node:path';

/**
 * A command the operator has already approved for use, resolved to the exact
 * executable and arguments that will run. Resolution happens once, at approval
 * time, so a model cannot smuggle shell syntax through the fields it controls.
 */
export type CommandProgram = {
  /** Human-readable label shown in approvals and results, for example `gh`. */
  name: string;
  /** Executable name resolved on PATH, or an absolute path the operator supplied. */
  executable: string;
  /** Arguments prepended to the model-supplied arguments on every invocation. */
  fixedArguments: string[];
};

export type CommandExecutionRequest = {
  program: CommandProgram;
  /** Model-supplied arguments. Never passed through a shell. */
  arguments: string[];
  /** Working directory. Defaults to the operator's home directory. */
  workingDirectory?: string;
  timeoutMs?: number;
};

export type CommandExecutionResult = {
  status: 'succeeded' | 'failed' | 'timeout' | 'cancelled';
  stdout: string;
  stderr: string;
  /** True when output hit the byte cap; the process was killed and the text is partial. */
  truncated: boolean;
  exitCode: number | null;
  durationMs: number;
};

export type CommandRunnerOptions = {
  programs: readonly CommandProgram[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxArguments?: number;
  maxArgumentLength?: number;
  /** Search PATH for executables. Defaults to the service environment PATH. */
  searchPath?: string;
};

export class CommandPolicyError extends Error {}

/** Executable names that never reach a process because they redirect the run to another one. */
const SHELL_BUILTINS = new Set(['cd', 'pushd', 'popd', 'source', 'alias', 'export', 'unset', 'set', 'exec', 'exit', 'history', 'jobs', 'fg', 'bg', 'kill', 'umask', 'eval', 'read', 'wait', 'shift', 'times', 'type', 'bind', 'shopt', 'hash', 'dirs', 'suspend']);

const EXPLICIT_PATH = /^(?:[a-zA-Z]:[\\/]|[\\/]|~\/)/;

export function resolveCommandProgram(programs: readonly CommandProgram[], name: string): CommandProgram {
  const requested = name.trim();
  if (!requested) throw new CommandPolicyError('Choose a command to run.');
  if (EXPLICIT_PATH.test(requested)) throw new CommandPolicyError('Choose an approved command by name. Absolute paths are not accepted.');
  const match = programs.find((candidate) => candidate.name === requested || candidate.executable === requested);
  if (!match) throw new CommandPolicyError(`${requested} is not an approved command for this workspace.`);
  return match;
}

/** True when the resolved executable can be found on the search path. */
export function commandAvailable(program: CommandProgram, searchPath?: string): boolean {
  if (isAbsolute(program.executable)) return true;
  const path = searchPath ?? process.env.PATH ?? '';
  if (!path) return false;
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter((extension) => extension.trim()) : [''];
  const directories = path.split(delimiter).filter((directory) => directory.trim());
  const candidates = [program.executable, ...extensions.map((extension) => `${program.executable}${extension}`)];
  for (const directory of directories) {
    for (const candidate of candidates) {
      // existsSync answers the question Bun.file cannot: it reports an
      // unreadable or missing entry instead of an empty file object.
      if (existsSync(join(directory, candidate))) return true;
    }
  }
  return false;
}

/**
 * Runs one approved command without a shell. Each invocation gets a wall-clock
 * timeout, a byte-capped output reader, and an environment that carries no
 * service configuration, so provider credentials never reach the process. The
 * environment keeps PATH so the resolved executable can load its own runtime
 * dependencies, and keeps HOME so tools with per-user configuration such as
 * `gh` and `docker` can find it. This contains runaway output but is not an OS
 * network or filesystem jail: a command runs with the same host access as any
 * program the operator chose to install.
 */
function safeEnvironment(): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const key of ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TERM', 'SHELL']) {
    const value = process.env[key];
    if (value !== undefined) kept[key] = value;
  }
  return kept;
}

export function createCommandRunner(options: CommandRunnerOptions) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxOutputBytes = options.maxOutputBytes ?? 256 * 1024;
  const maxArguments = options.maxArguments ?? 64;
  const maxArgumentLength = options.maxArgumentLength ?? 4096;
  const searchPath = options.searchPath ?? process.env.PATH;
  const programs = options.programs;

  return {
    programs: (): readonly CommandProgram[] => programs,
    /** Reports which approved commands are installed, so the UI can show why one is unavailable. */
    availability(): { name: string; available: boolean }[] {
      return programs.map((program) => ({ name: program.name, available: !SHELL_BUILTINS.has(program.executable) && commandAvailable(program, searchPath) }));
    },
    async execute(request: CommandExecutionRequest, signal?: AbortSignal): Promise<CommandExecutionResult> {
      const program = resolveCommandProgram(programs, request.program.name);
      const args = [...program.fixedArguments, ...request.arguments];
      if (SHELL_BUILTINS.has(program.executable)) throw new CommandPolicyError(`${program.name} is a shell built-in and cannot run as its own process.`);
      if (args.length > maxArguments) throw new CommandPolicyError(`This command accepts at most ${maxArguments} arguments.`);
      if (request.arguments.some((argument) => argument.length > maxArgumentLength)) throw new CommandPolicyError(`Each argument must be ${maxArgumentLength} characters or fewer.`);
      if (request.workingDirectory !== undefined && request.workingDirectory !== '' && !isAbsolute(request.workingDirectory)) throw new CommandPolicyError('The working directory must be an absolute path.');
      if (!commandAvailable(program, searchPath)) throw new CommandPolicyError(`${program.name} is not installed on this machine. Install it, then run the command again.`);
      const boundedTimeoutMs = Math.min(Math.max(Math.trunc(request.timeoutMs ?? timeoutMs), 1000), 600_000);
      const started = Date.now();
      const directory = request.workingDirectory?.trim() || homedir();
      let timedOut = false;
      // nosemgrep: javascript.lang.security.detect-child-process -- executable is selected from the fixed allowlist; shell:false passes arguments without shell interpretation.
      const child = spawn(program.executable, args, { shell: false, windowsHide: true, cwd: directory, env: safeEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, boundedTimeoutMs);
      const onAbort = () => child.kill();
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      const collect = async (stream: NodeJS.ReadableStream | null): Promise<{ text: string; truncated: boolean }> => {
        if (!stream) return { text: '', truncated: false };
        const decoder = new TextDecoder();
        let text = '';
        let bytes = 0;
        let truncated = false;
        const push = (value: Uint8Array | string): void => {
          const piece = typeof value === 'string' ? new TextEncoder().encode(value) : value;
          const remaining = maxOutputBytes - bytes;
          if (remaining <= 0) { truncated = true; return; }
          const slice = piece.byteLength > remaining ? piece.subarray(0, remaining) : piece;
          bytes += slice.byteLength;
          text += decoder.decode(slice, { stream: true });
          if (slice.byteLength < piece.byteLength) truncated = true;
        };
        // Reading through events rather than an async iterator keeps a killed
        // process from raising ERR_STREAM_PREMATURE_CLOSE over the output it
        // already produced, which is the text the operator needs to see.
        await new Promise<void>((resolveStream) => {
          let settled = false;
          const stop = () => {
            if (settled) return;
            settled = true;
            stream.off('data', push);
            stream.off('end', finish);
            stream.off('close', finish);
            stream.off('error', finish);
            resolveStream();
          };
          const finish = () => { stop(); };
          stream.on('data', push);
          stream.once('end', finish);
          stream.once('close', finish);
          stream.once('error', finish);
          if ((stream as { readableEnded?: boolean }).readableEnded === true) finish();
        });
        return { text: text + decoder.decode(), truncated };
      };
      let output: { stdout: string; stderr: string; truncated: boolean; exitCode: number | null };
      try {
        const [out, err, exitCode] = await Promise.all([collect(child.stdout), collect(child.stderr), new Promise<number | null>((resolveExit) => { child.once('close', (code) => resolveExit(code)); child.once('error', () => resolveExit(null)); })]);
        output = { stdout: out.text, stderr: err.text, truncated: out.truncated || err.truncated, exitCode };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
      const status: CommandExecutionResult['status'] = signal?.aborted ? 'cancelled' : timedOut ? 'timeout' : output.exitCode === 0 ? 'succeeded' : 'failed';
      return { status, ...output, durationMs: Date.now() - started };
    }
  };
}

export type CommandRunner = ReturnType<typeof createCommandRunner>;
