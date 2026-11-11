import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

/**
 * Easy-to-find copies of shippable installers / app bundles (not the bare host exe).
 * Portable path inside the checkout; covered by the root dist gitignore.
 */
export function desktopPublishDir(): string {
  return join(repoRoot, 'dist', 'desktop');
}
