/**
 * Print (and open) shippable desktop installers / app bundles.
 * The bare host exe is intentionally ignored — it does not run alone.
 *
 *   bun run desktop:artifacts
 *   bun run desktop:artifacts -- --open
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { desktopPublishDir } from './desktop-publish.adapter';

const openExplorer = process.argv.includes('--open');
const publishDir = desktopPublishDir();

function isInstallerName(name: string): boolean {
  if (/\.(msix|msixbundle|msi|dmg|deb|AppImage|zip)$/i.test(name)) return true;
  if (name.endsWith('.app')) return true;
  // NSIS setup — not the bare host binary
  if (/\.exe$/i.test(name) && /setup|installer|AIR-Office-Setup/i.test(name)) return true;
  if (/AIR Office_.*\.exe$/i.test(name)) return true;
  return false;
}

function listInstallers(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isInstallerName)
    .map((name) => join(dir, name))
    .filter((path) => {
      try {
        const st = statSync(path);
        return st.isFile() || path.endsWith('.app');
      } catch {
        return false;
      }
    });
}

const published = listInstallers(publishDir);

console.log('Install / ship these (bare Electron host will not run alone):');
console.log(`  ${publishDir}`);
if (published.length === 0) {
  console.log('  (empty — run bun run build:desktop)');
} else {
  for (const path of published) console.log(`  ${path}`);
}

const reveal = published[0];
if (openExplorer && reveal) {
  if (process.platform === 'win32') {
    spawnSync('explorer', [`/select,${reveal}`], { stdio: 'ignore', windowsHide: true });
  } else if (process.platform === 'darwin') {
    spawnSync('open', ['-R', reveal], { stdio: 'ignore' });
  } else {
    spawnSync('xdg-open', [join(reveal, '..')], { stdio: 'ignore' });
  }
  console.log('');
  console.log(`Opened file manager on: ${reveal}`);
} else if (!openExplorer && reveal) {
  console.log('');
  console.log('Tip: bun run desktop:artifacts -- --open');
}
