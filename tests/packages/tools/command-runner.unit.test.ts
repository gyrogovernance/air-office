import { describe, expect, test } from 'bun:test';
import { createCommandRunner, commandAvailable, resolveCommandProgram, CommandPolicyError, type CommandProgram } from '../../../packages/tools/src/command-runner.adapter';

/**
 * `echo` is a shell built-in on Windows and an executable elsewhere, so the
 * execution fixtures use the runtime that runs these tests, which exists on
 * every platform this suite runs on.
 */
const runtime: CommandProgram = { name: 'runtime', executable: process.execPath, fixedArguments: [] };
const runtimeWithFlags: CommandProgram = { name: 'runtime-flags', executable: process.execPath, fixedArguments: ['--print'] };
const missing: CommandProgram = { name: 'missing-tool', executable: 'definitely-not-installed-air-office-probe', fixedArguments: [] };
const programs: readonly CommandProgram[] = [runtime, runtimeWithFlags, missing];

describe('command policy resolution', () => {
  test('resolves an approved command by name', () => {
    expect(resolveCommandProgram(programs, 'runtime')).toMatchObject({ name: 'runtime', executable: process.execPath });
  });

  test('resolves by executable only when the caller passes a bare name the operator approved', () => {
    expect(resolveCommandProgram([{ name: 'unique-tool', executable: 'unique-executable-name', fixedArguments: [] }], 'unique-executable-name').name).toBe('unique-tool');
  });

  test('refuses a command that is not approved', () => {
    expect(() => resolveCommandProgram(programs, 'rm')).toThrow(CommandPolicyError);
  });

  test('refuses an absolute or relative path instead of resolving it', () => {
    expect(() => resolveCommandProgram(programs, '/usr/bin/env')).toThrow(CommandPolicyError);
    expect(() => resolveCommandProgram(programs, './runtime')).toThrow(CommandPolicyError);
    expect(() => resolveCommandProgram(programs, process.execPath)).toThrow(CommandPolicyError);
  });

  test('refuses shell built-ins that cannot run as their own process', () => {
    const builtins: readonly CommandProgram[] = [{ name: 'cd', executable: 'cd', fixedArguments: [] }];
    expect(commandAvailable(builtins[0]!)).toBe(false);
    const runner = createCommandRunner({ programs: builtins });
    expect(runner.availability()[0]).toEqual({ name: 'cd', available: false });
  });
});

describe('command execution', () => {
  test('runs an approved command and captures its output', async () => {
    const runner = createCommandRunner({ programs });
    const result = await runner.execute({ program: runtime, arguments: ['--version'] });
    expect(result.status).toBe('succeeded');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  test('prepends the fixed arguments the operator approved', async () => {
    const runner = createCommandRunner({ programs });
    const result = await runner.execute({ program: runtimeWithFlags, arguments: ['1+1'] });
    expect(result.status).toBe('succeeded');
    expect(result.stdout.trim()).toBe('2');
  });

  test('reports a non-zero exit code as failed', async () => {
    const failing: readonly CommandProgram[] = [{ name: 'runtime-exit', executable: process.execPath, fixedArguments: ['--eval', 'process.exit(3)'] }];
    const runner = createCommandRunner({ programs: failing });
    const result = await runner.execute({ program: failing[0]!, arguments: [] });
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(3);
  });

  test('refuses an unapproved command even when the executable exists', async () => {
    const runner = createCommandRunner({ programs });
    await expect(runner.execute({ program: { name: 'nope', executable: process.execPath, fixedArguments: [] }, arguments: [] })).rejects.toThrow(CommandPolicyError);
  });

  test('refuses more arguments than the configured limit', async () => {
    const runner = createCommandRunner({ programs, maxArguments: 1 });
    await expect(runner.execute({ program: runtime, arguments: ['--version', 'extra'] })).rejects.toThrow(/at most 1 argument/);
  });

  test('refuses an argument longer than the configured limit', async () => {
    const runner = createCommandRunner({ programs, maxArgumentLength: 8 });
    await expect(runner.execute({ program: runtime, arguments: ['x'.repeat(20)] })).rejects.toThrow(/8 characters or fewer/);
  });

  test('refuses a relative working directory', async () => {
    const runner = createCommandRunner({ programs });
    await expect(runner.execute({ program: runtime, arguments: [], workingDirectory: 'relative/path' })).rejects.toThrow(/absolute path/);
  });

  test('reports a timeout and stops the process', async () => {
    const slow: readonly CommandProgram[] = [{ name: 'runtime-slow', executable: process.execPath, fixedArguments: ['--eval', 'setTimeout(() => {}, 60000)'] }];
    const runner = createCommandRunner({ programs: slow, timeoutMs: 1500 });
    const result = await runner.execute({ program: slow[0]!, arguments: [] });
    expect(result.status).toBe('timeout');
    expect(result.durationMs).toBeLessThan(10_000);
  });

  test('cancels a running command when the caller aborts', async () => {
    const controller = new AbortController();
    const slow: readonly CommandProgram[] = [{ name: 'runtime-slow', executable: process.execPath, fixedArguments: ['--eval', 'setTimeout(() => {}, 60000)'] }];
    const runner = createCommandRunner({ programs: slow });
    const pending = runner.execute({ program: slow[0]!, arguments: [] }, controller.signal);
    controller.abort();
    const result = await pending;
    expect(result.status).toBe('cancelled');
  });

  test('reports a command that is not installed instead of running it', async () => {
    const runner = createCommandRunner({ programs });
    await expect(runner.execute({ program: missing, arguments: [] })).rejects.toThrow(/not installed/);
  });

  test('caps output at the configured byte limit and marks it truncated', async () => {
    const noisy: readonly CommandProgram[] = [{ name: 'runtime-noisy', executable: process.execPath, fixedArguments: ['--eval', 'process.stdout.write("a".repeat(200000))'] }];
    const runner = createCommandRunner({ programs: noisy, maxOutputBytes: 4096 });
    const result = await runner.execute({ program: noisy[0]!, arguments: [] });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(4096);
  });
});
