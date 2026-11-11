import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  stageWorkbenchShellExtension,
  WORKBENCH_SHELL_EXTENSION_ID,
  WORKBENCH_SHELL_EXTENSION_VERSION,
} from '../../service/src/workbench-file.adapter';
import { extractArchiveToFreshDirectory } from './artifact-archive.adapter';

type ExtensionPin = {
  id: string;
  version: string;
  size: number;
  digest: string;
  url: string;
};

/** Minimal OpenVSX set for connected-folder language tooling. */
const EXTENSIONS: readonly ExtensionPin[] = [
  {
    id: 'ms-python.python',
    version: '2026.4.0',
    size: 6826731,
    digest: '232aeafb01f069824fdd92d3e628c1c442bbcfa1d3cc945ff97076340bb2b4a6',
    url: 'https://open-vsx.org/api/ms-python/python/2026.4.0/file/ms-python.python-2026.4.0.vsix'
  },
  {
    id: 'vscode.typescript-language-features',
    version: '1.95.3',
    size: 11510122,
    digest: 'b1494642a46d1b139ab799e2ee0ae2453bdcef6ed1a718acca034445cfd9d87f',
    url: 'https://open-vsx.org/api/vscode/typescript-language-features/1.95.3/file/vscode.typescript-language-features-1.95.3.vsix'
  },
  {
    id: 'dbaeumer.vscode-eslint',
    version: '3.0.34',
    size: 264365,
    digest: 'ca5334d46f6a39079e751ef4601bfc9f86bc3a46483e87291ec609239d161308',
    url: 'https://open-vsx.org/api/dbaeumer/vscode-eslint/3.0.34/file/dbaeumer.vscode-eslint-3.0.34.vsix'
  }
];

/** Downloads pinned OpenVSX VSIX packages into the staged workbench extensions directory. */
export async function prepareWorkbenchExtensions(resourcesRoot: string, vendorRoot: string): Promise<string[]> {
  const destination = join(resourcesRoot, 'code-server', 'bundled-extensions');
  mkdirSync(destination, { recursive: true });
  mkdirSync(vendorRoot, { recursive: true });
  const installed: string[] = [];
  stageWorkbenchShellExtension(destination);
  installed.push(`${WORKBENCH_SHELL_EXTENSION_ID}@${WORKBENCH_SHELL_EXTENSION_VERSION}`);
  for (const extension of EXTENSIONS) {
    const cachePath = join(vendorRoot, `${extension.id}-${extension.version}.vsix`);
    let bytes: Buffer;
    if (existsSync(cachePath) && createHash('sha256').update(readFileSync(cachePath)).digest('hex') === extension.digest) bytes = readFileSync(cachePath);
    else {
      const response = await fetch(extension.url);
      if (!response.ok) throw new Error(`Workbench extension download failed for ${extension.id} with HTTP ${response.status}.`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength !== extension.size || createHash('sha256').update(bytes).digest('hex') !== extension.digest) {
        throw new Error(`Workbench extension ${extension.id} did not match the pinned digest.`);
      }
      writeFileSync(cachePath, bytes);
    }
    const tempRoot = join(resourcesRoot, '.workbench-extension-download', extension.id);
    rmSync(tempRoot, { recursive: true, force: true });
    mkdirSync(tempRoot, { recursive: true });
    try {
      const archivePath = join(tempRoot, `${extension.id}.vsix`);
      writeFileSync(archivePath, bytes);
      const extracted = join(tempRoot, 'extracted');
      await extractArchiveToFreshDirectory(archivePath, extracted, 'zip', { maxEntries: 50000, maxBytes: 64 * 1024 ** 2, maxFileBytes: 32 * 1024 ** 2 });
      const packageRoot = existsSync(join(extracted, 'extension', 'package.json'))
        ? join(extracted, 'extension')
        : readdirSync(extracted, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(extracted, entry.name)).find((candidate) => existsSync(join(candidate, 'package.json')));
      if (!packageRoot) throw new Error(`Workbench extension ${extension.id} has no package root.`);
      const folder = join(destination, `${extension.id}-${extension.version}`);
      rmSync(folder, { recursive: true, force: true });
      cpSync(packageRoot, folder, { recursive: true });
      installed.push(`${extension.id}@${extension.version}`);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
  return installed;
}

export function syncBundledWorkbenchExtensions(bundledRoot: string, extensionsDir: string): void {
  if (!existsSync(bundledRoot)) return;
  mkdirSync(extensionsDir, { recursive: true });
  for (const entry of readdirSync(bundledRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const target = join(extensionsDir, entry.name);
    const overwrite = entry.name.startsWith(`${WORKBENCH_SHELL_EXTENSION_ID}-`);
    if (existsSync(target) && !overwrite) continue;
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    cpSync(join(bundledRoot, entry.name), target, { recursive: true });
  }
}
