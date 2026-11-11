import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function writePythonInterpreterPath(privateRoot: string, interpreterPath: string): void {
  const file = join(privateRoot, 'workbench-python-interpreter.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ path: interpreterPath }));
}

export function pythonInterpreterPath(privateRoot: string): string | null {
  const file = join(privateRoot, 'workbench-python-interpreter.json');
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { path?: unknown };
    return typeof parsed.path === 'string' && parsed.path.trim() ? parsed.path.trim() : null;
  } catch { return null; }
}

