import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { resolveVaultRoot } from './vault.host.public';

const EXCLUDE_DIR_NAMES = new Set(['runtime']);

function shouldSkip(relativeParts: string[]): boolean {
  // Exclude .air/runtime and anything under it.
  if (relativeParts[0] === '.air' && relativeParts[1] === 'runtime') return true;
  // Credentials never belong in a portable vault archive.
  if (relativeParts.some((part) => /credential|secret|keychain/i.test(part))) return true;
  return false;
}

function listFiles(root: string, current: string, relativeParts: string[], out: string[]): void {
  if (shouldSkip(relativeParts)) return;
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.name === '.' || entry.name === '..') continue;
    const nextParts = [...relativeParts, entry.name];
    if (entry.isDirectory()) {
      if (relativeParts[0] === '.air' && entry.name === 'runtime') continue;
      if (EXCLUDE_DIR_NAMES.has(entry.name) && relativeParts[0] === '.air') continue;
      listFiles(root, join(current, entry.name), nextParts, out);
      continue;
    }
    if (shouldSkip(nextParts)) continue;
    out.push(nextParts.join('/'));
  }
}

/**
 * F-016: zip of AIR_VAULT_ROOT excluding `.air/runtime` and credential-looking paths.
 * Uses the host `tar` so Windows and Unix share one path (`tar -a` builds zip).
 */
export async function exportVaultZip(vaultRoot = resolveVaultRoot()): Promise<Uint8Array> {
  const root = resolveVaultRoot(vaultRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('Vault root is missing.');
  const files: string[] = [];
  listFiles(root, root, [], files);
  if (files.length === 0) throw new Error('Vault has no portable files to export.');
  const scratch = mkdtempSync(join(tmpdir(), 'air-vault-zip-'));
  const archive = join(scratch, 'vault.zip');
  try {
    const listFile = join(scratch, 'files.txt');
    await Bun.write(listFile, `${files.join('\n')}\n`);
    const result = await $`tar -a -cf ${archive} -C ${root} -T ${listFile}`.quiet().nothrow();
    if (result.exitCode !== 0 || !existsSync(archive)) {
      throw new Error(`Vault zip failed: ${result.stderr.toString() || result.stdout.toString() || 'tar exit ' + result.exitCode}`);
    }
    return new Uint8Array(await Bun.file(archive).arrayBuffer());
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Extract a portable vault zip into an empty or fresh destination vault root. */
export async function importVaultZip(bytes: Uint8Array, destinationRoot: string): Promise<void> {
  const root = resolveVaultRoot(destinationRoot);
  mkdirSync(root, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'air-vault-unzip-'));
  const archive = join(scratch, 'vault.zip');
  try {
    await Bun.write(archive, bytes);
    const result = await $`tar -xf ${archive} -C ${root}`.quiet().nothrow();
    if (result.exitCode !== 0) {
      throw new Error(`Vault unzip failed: ${result.stderr.toString() || result.stdout.toString() || 'tar exit ' + result.exitCode}`);
    }
    const runtime = join(root, '.air', 'runtime');
    if (existsSync(runtime)) rmSync(runtime, { recursive: true, force: true });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
