import { expect, test } from 'bun:test';
import { createCodeInterpreter } from '../../../packages/tools/src/code-interpreter.adapter';

test('a successful snippet returns stdout with a succeeded status', async () => {
  const result = await createCodeInterpreter().execute({ code: `console.log('hello ' + (2 + 3));` });
  expect(result.status).toBe('succeeded');
  expect(result.stdout.trim()).toBe('hello 5');
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  expect(result.truncated).toBe(false);
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
});

test('a failing snippet reports its exit code and stderr', async () => {
  const result = await createCodeInterpreter().execute({ code: `console.error('boom'); process.exit(3);` });
  expect(result.status).toBe('failed');
  expect(result.exitCode).toBe(3);
  expect(result.stderr).toContain('boom');
});

test('the snippet environment carries no service configuration', async () => {
  process.env.AIR_INTERPRETER_PROBE = 'service-secret';
  try {
    const result = await createCodeInterpreter().execute({ code: `console.log(JSON.stringify({ probe: process.env.AIR_INTERPRETER_PROBE ?? null, temp: process.env.TEMP ?? '' }));` });
    expect(result.status).toBe('succeeded');
    const payload = JSON.parse(result.stdout.trim()) as { probe: string | null; temp: string };
    expect(payload.probe).toBeNull();
    expect(payload.temp).toContain('air-code-');
  } finally {
    delete process.env.AIR_INTERPRETER_PROBE;
  }
});

test('a runaway snippet is stopped at the timeout', async () => {
  const started = Date.now();
  const result = await createCodeInterpreter().execute({ code: `while (true) {}`, timeoutMs: 300 });
  expect(result.status).toBe('timeout');
  expect(Date.now() - started).toBeLessThan(5_000);
});

test('an aborted signal cancels the snippet', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  const result = await createCodeInterpreter().execute({ code: `while (true) {}`, timeoutMs: 60_000 }, controller.signal);
  expect(result.status).toBe('cancelled');
});

test('output beyond the byte cap is truncated and the process is stopped', async () => {
  const result = await createCodeInterpreter({ maxOutputBytes: 1000 }).execute({ code: `process.stdout.write('>'.repeat(5000));` });
  expect(result.truncated).toBe(true);
  expect(result.stdout.length).toBe(1000);
});

test('the interpreter rejects unsupported languages and empty snippets', async () => {
  const interpreter = createCodeInterpreter();
  await expect(interpreter.execute({ code: 'print(1)', language: 'python' })).rejects.toThrow('JavaScript snippets only');
  await expect(interpreter.execute({ code: '   ' })).rejects.toThrow('Provide a code snippet');
});
