/**
 * Product desktop build entry. Compiles the Bun service sidecar, stages
 * resources, builds the web UI, builds the Electron host, and packages
 * unsigned installers. This is the release path; `bun run dev` is development only.
 *
 * Usage:
 *   bun run build:desktop
 *   bun run build:desktop:windows
 *   bun run build:desktop:mac:intel
 *   bun run build:desktop:mac:arm
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const desktopRoot = join(repoRoot, 'apps', 'desktop');
const publishDir = join(repoRoot, 'dist', 'desktop');

function run(command: string, args: string[], cwd = repoRoot, env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}.`);
}

function publishArtifacts(sources: string[]): string[] {
  mkdirSync(publishDir, { recursive: true });
  const ready: string[] = [];
  for (const source of sources) {
    if (!existsSync(source)) continue;
    const st = statSync(source);
    if (st.isDirectory()) continue;
    const dest = join(publishDir, basename(source));
    // electron-builder already writes into dist/desktop; do not copy a file onto itself.
    if (source !== dest) copyFileSync(source, dest);
    ready.push(dest);
  }
  return ready;
}

function artifactArchFilter(packArgs: string[]): RegExp | null {
  if (packArgs.includes('pack:mac:intel') || packArgs.includes('--x64')) return /(?:^|-)x64\./i;
  if (packArgs.includes('pack:mac:arm') || packArgs.includes('--arm64')) return /(?:^|-)arm64\./i;
  if (packArgs.includes('pack:win')) return /(?:^|-)x64\./i;
  return null;
}

function listBuilderArtifacts(packArgs: string[]): string[] {
  if (!existsSync(publishDir)) return [];
  const archFilter = artifactArchFilter(packArgs);
  return readdirSync(publishDir)
    .filter((name) => /\.(exe|dmg|zip|AppImage|deb)$/i.test(name))
    .filter((name) => (archFilter ? archFilter.test(name) : true))
    .filter((name) => existsSync(join(publishDir, name)))
    .map((name) => join(publishDir, name));
}

const args = process.argv.slice(2);
let packArgs: string[] = [];
if (args.includes('--bundles') || args.some((a) => a.startsWith('--target'))) {
  // Compatibility with older CLI flags.
  if (process.platform === 'win32') packArgs = ['run', 'pack:win'];
  else if (process.platform === 'darwin' && process.arch === 'arm64') packArgs = ['run', 'pack:mac:arm'];
  else if (process.platform === 'darwin') packArgs = ['run', 'pack:mac:intel'];
  else packArgs = ['run', 'pack'];
} else if (args.includes('mac:intel')) {
  packArgs = ['run', 'pack:mac:intel'];
} else if (args.includes('mac:arm')) {
  packArgs = ['run', 'pack:mac:arm'];
} else if (process.platform === 'win32') {
  packArgs = ['run', 'pack:win'];
} else if (process.platform === 'darwin' && process.arch === 'arm64') {
  packArgs = ['run', 'pack:mac:arm'];
} else if (process.platform === 'darwin') {
  packArgs = ['run', 'pack:mac:intel'];
} else {
  packArgs = ['run', 'pack'];
}

/** Keep prepare + pack on the same triple so Silicon shells never get Intel Lemonade/service. */
function resolveTargetTriple(selectedPackArgs: string[]): string | undefined {
  if (selectedPackArgs.includes('pack:mac:intel')) return 'x86_64-apple-darwin';
  if (selectedPackArgs.includes('pack:mac:arm')) return 'aarch64-apple-darwin';
  if (selectedPackArgs.includes('pack:win')) return 'x86_64-pc-windows-msvc';
  const targetFlag = args.find((value) => value.startsWith('--target'));
  if (targetFlag?.includes('=')) return targetFlag.slice('--target='.length);
  const targetIndex = args.indexOf('--target');
  if (targetIndex >= 0) return args[targetIndex + 1];
  return undefined;
}

const targetTriple = resolveTargetTriple(packArgs);
const buildEnv = {
  ...process.env,
  ...(targetTriple ? { TARGET: targetTriple } : {}),
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  CSC_IDENTITY: '',
};

console.info(`Preparing desktop artifact inputs${targetTriple ? ` for ${targetTriple}` : ''}…`);
run(process.execPath, ['run', 'prepare-desktop-artifact'], repoRoot, buildEnv);

console.info('Building Electron main/preload…');
run(process.execPath, ['run', 'build'], desktopRoot, buildEnv);

console.info('Packaging unsigned installer…');
run(process.execPath, packArgs, desktopRoot, buildEnv);

const artifacts = listBuilderArtifacts(packArgs);
const published = publishArtifacts(artifacts);
console.info(`Desktop package ready. Artifacts: ${published.length ? published.join(', ') : '(see dist/desktop)'}`);
