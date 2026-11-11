/**
 * Removes regenerable desktop build leftovers from the working tree.
 * Does not touch `.dev/` (local study material).
 *
 * Usage:
 *   bun run clean:desktop
 *   bun run clean:desktop -- --caches
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { desktopPublishDir } from './desktop-publish.adapter';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const desktopRoot = join(repoRoot, 'apps', 'desktop');
const purgeCaches = process.argv.includes('--caches');

function removeTree(path: string): void {
  if (!existsSync(path)) return;
  if (process.platform === 'win32') {
    const empty = join(repoRoot, '.tmp', `empty-clean-${process.pid}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(empty, { recursive: true });
    spawnSync('robocopy', [empty, path, '/MIR', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP'], { stdio: 'ignore' });
    spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', path], { stdio: 'ignore' });
    spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', empty], { stdio: 'ignore' });
    if (!existsSync(path)) return;
  }
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not remove ${path} (${detail}). Close AIR Office / code-server / antivirus locks, then retry.`);
  }
}

function sizeLabel(path: string): string {
  return existsSync(path) ? 'present' : 'absent';
}

const inTree = [
  join(desktopRoot, 'resources'),
  join(desktopRoot, 'binaries'),
  join(desktopRoot, 'out'),
  join(repoRoot, 'apps', 'web', 'dist'),
  desktopPublishDir(),
];

const cacheTrees = purgeCaches
  ? [join(repoRoot, '.tmp', 'cargo-target'), join(repoRoot, 'node_modules', '.cache')]
  : [];

console.info(JSON.stringify({
  component: 'desktop-clean',
  operation: 'start',
  inTree: Object.fromEntries(inTree.map((path) => [path, sizeLabel(path)])),
  purgeCaches,
}));

for (const path of [...inTree, ...cacheTrees]) {
  removeTree(path);
}

console.info(JSON.stringify({
  component: 'desktop-clean',
  operation: 'done',
  inTree: Object.fromEntries(inTree.map((path) => [path, sizeLabel(path)])),
}));
