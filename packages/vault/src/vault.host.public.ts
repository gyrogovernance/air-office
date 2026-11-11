import { createHash } from 'node:crypto';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { normalizeVaultRelative } from './vault.domain.public';

/** Resolve AIR_VAULT_ROOT from the environment or an explicit override. */
export function resolveVaultRoot(override?: string): string {
  const raw = override?.trim() || process.env.AIR_VAULT_ROOT?.trim();
  if (!raw) throw new Error('AIR_VAULT_ROOT is not configured.');
  return resolve(raw);
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function sha256Bytes(value: Uint8Array | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Join vault root with a relative path and reject escape. */
export function resolveUnderVault(root: string, relativePath: string): string {
  const rel = normalizeVaultRelative(relativePath);
  const absolute = resolve(root, ...rel.split('/'));
  const rootResolved = resolve(root);
  const prefix = rootResolved.endsWith(sep) ? rootResolved : `${rootResolved}${sep}`;
  if (absolute !== rootResolved && !absolute.startsWith(prefix)) {
    throw new Error(`Path escapes vault root: ${relativePath}`);
  }
  return absolute;
}

export function toVaultRelative(root: string, absolutePath: string): string {
  const rel = relative(resolve(root), resolve(absolutePath)).replace(/\\/g, '/');
  if (!rel || rel.startsWith('../') || isAbsolute(rel)) throw new Error(`Path is outside vault: ${absolutePath}`);
  return normalizeVaultRelative(rel);
}

export function joinVault(...parts: string[]): string {
  return normalize(join(...parts));
}
