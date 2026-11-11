/**
 * Distinct static GitHub Pages build. Never writes product `apps/web/dist`.
 * Exports a fresh demo snapshot first, then Vite-builds into `dist-static-demo`.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  return new Promise((resolveCode, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) => resolveCode(code ?? 1));
  });
}

const bun = process.execPath;
const skipExport = process.env.SKIP_STATIC_DEMO_EXPORT === '1';
if (!skipExport) {
  const exportCode = await run(bun, [resolve('tools/export-static-demo.entry.ts')]);
  if (exportCode !== 0) process.exit(exportCode);
}

const buildCode = await run(bun, ['run', '--cwd', 'apps/web', 'build'], {
  ...process.env,
  VITE_STATIC_DEMO: '1',
});
process.exit(buildCode);
