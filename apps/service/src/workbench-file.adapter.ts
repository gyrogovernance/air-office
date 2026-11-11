import { Database } from 'bun:sqlite';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WORKBENCH_SHELL_EXTENSION_ID = 'airoffice.shell';
export const WORKBENCH_SHELL_EXTENSION_VERSION = '1.0.0';
export const WORKBENCH_SHELL_EXTENSION_FOLDER = `${WORKBENCH_SHELL_EXTENSION_ID}-${WORKBENCH_SHELL_EXTENSION_VERSION}`;
export const WORKBENCH_SHELL_STYLE_ID = 'air-office-code-chrome';

/** Repository source, or the already-staged package under OFFICE_RESOURCE_ROOT. */
export function workbenchShellExtensionSourceRoot(): string {
  // Prefer the staged desktop resource tree. The compiled `air-office-service`
  // binary resolves `import.meta.url` to a useless path (often `/…`), so the
  // module-relative fallback must not win when OFFICE_RESOURCE_ROOT is set.
  const resourceRoot = Bun.env.OFFICE_RESOURCE_ROOT?.trim();
  if (resourceRoot) {
    const staged = join(resourceRoot, 'code-server', 'bundled-extensions', WORKBENCH_SHELL_EXTENSION_FOLDER);
    if (existsSync(join(staged, 'package.json'))) return staged;
  }
  // Dev/source layout: apps/service/src → apps/workbench-shell-extension.
  const fromModule = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'workbench-shell-extension');
  if (existsSync(join(fromModule, 'package.json'))) return fromModule;
  return resourceRoot
    ? join(resourceRoot, 'code-server', 'bundled-extensions', WORKBENCH_SHELL_EXTENSION_FOLDER)
    : fromModule;
}

/** Copies the shell extension into a code-server bundled-extensions directory (always overwrites). */
export function stageWorkbenchShellExtension(bundledExtensionsDir: string, sourceRoot = workbenchShellExtensionSourceRoot()): string {
  if (!existsSync(join(sourceRoot, 'package.json'))) {
    throw new Error(`AIR Office Code shell extension is missing at ${sourceRoot}.`);
  }
  mkdirSync(bundledExtensionsDir, { recursive: true });
  const target = join(bundledExtensionsDir, WORKBENCH_SHELL_EXTENSION_FOLDER);
  rmSync(target, { recursive: true, force: true });
  cpSync(sourceRoot, target, { recursive: true });
  return target;
}

type WorkbenchExtensionCatalogEntry = {
  identifier: { id: string; uuid?: string };
  version: string;
  location: { $mid: number; path: string; scheme: string };
  relativeLocation: string;
  metadata?: Record<string, unknown>;
};

function workbenchExtensionCatalogPath(extensionsDir: string): string {
  return join(extensionsDir, 'extensions.json');
}

function readWorkbenchExtensionCatalog(extensionsDir: string): WorkbenchExtensionCatalogEntry[] {
  const path = workbenchExtensionCatalogPath(extensionsDir);
  if (!existsSync(path)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? parsed as WorkbenchExtensionCatalogEntry[] : [];
  } catch {
    return [];
  }
}

export function workbenchShellExtensionRegistered(extensionsDir: string): boolean {
  return readWorkbenchExtensionCatalog(extensionsDir).some((entry) => entry?.identifier?.id === WORKBENCH_SHELL_EXTENSION_ID);
}

/**
 * code-server only loads extensions listed in extensions.json. Copying the
 * folder alone is not enough after the catalog has already been written.
 */
export function registerWorkbenchShellExtension(extensionsDir: string): void {
  mkdirSync(extensionsDir, { recursive: true });
  const folder = join(extensionsDir, WORKBENCH_SHELL_EXTENSION_FOLDER);
  if (!existsSync(join(folder, 'package.json'))) {
    throw new Error(`AIR Office Code shell extension is not installed at ${folder}.`);
  }
  const absolute = resolve(folder).replace(/\\/g, '/');
  const locationPath = /^[A-Za-z]:\//.test(absolute) ? `/${absolute}` : absolute.startsWith('/') ? absolute : `/${absolute}`;
  const entry: WorkbenchExtensionCatalogEntry = {
    identifier: { id: WORKBENCH_SHELL_EXTENSION_ID },
    version: WORKBENCH_SHELL_EXTENSION_VERSION,
    location: { $mid: 1, path: locationPath, scheme: 'file' },
    relativeLocation: WORKBENCH_SHELL_EXTENSION_FOLDER,
  };
  const next = readWorkbenchExtensionCatalog(extensionsDir).filter((item) => item?.identifier?.id !== WORKBENCH_SHELL_EXTENSION_ID);
  next.push(entry);
  writeFileSync(workbenchExtensionCatalogPath(extensionsDir), `${JSON.stringify(next)}\n`);
}

function findWorkbenchShellCssPath(codeServerRoot: string): string | null {
  const bundled = join(codeServerRoot, 'bundled-extensions');
  const staged = join(bundled, WORKBENCH_SHELL_EXTENSION_FOLDER, 'media', 'shell.css');
  if (existsSync(staged)) return staged;
  if (existsSync(bundled)) {
    for (const entry of readdirSync(bundled, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(`${WORKBENCH_SHELL_EXTENSION_ID}-`)) continue;
      const candidate = join(bundled, entry.name, 'media', 'shell.css');
      if (existsSync(candidate)) return candidate;
    }
  }
  const source = join(workbenchShellExtensionSourceRoot(), 'media', 'shell.css');
  return existsSync(source) ? source : null;
}

/** CSS that removes VS Code chat / secondary side bar chrome from the embedded Code surface. */
export function resolveWorkbenchShellCss(codeServerRoot?: string | null): string {
  const path = codeServerRoot ? findWorkbenchShellCssPath(codeServerRoot) : join(workbenchShellExtensionSourceRoot(), 'media', 'shell.css');
  if (path && existsSync(path)) {
    const body = readFileSync(path, 'utf8').trim();
    if (body.includes(`#${WORKBENCH_SHELL_STYLE_ID}`) || body.includes('air-office-code-chrome')) return body;
    return `#${WORKBENCH_SHELL_STYLE_ID} {/* marker */}\n${body}`;
  }
  return WORKBENCH_SHELL_CSS_FALLBACK;
}

/** Fallback when the shell extension CSS file is not staged yet. */
export const WORKBENCH_SHELL_CSS_FALLBACK = `
#${WORKBENCH_SHELL_STYLE_ID} {/* marker */}
.monaco-workbench .part.auxiliarybar { display: none !important; visibility: hidden !important; width: 0 !important; min-width: 0 !important; }
.monaco-workbench .codicon-layout-sidebar-right,
.monaco-workbench .codicon-layout-sidebar-right-off { display: none !important; }
.monaco-workbench .action-label[aria-label*="Secondary Side Bar"],
.monaco-workbench .action-item[aria-label*="Secondary Side Bar"],
.monaco-workbench .action-label[aria-label*="Toggle Secondary Side Bar"],
.monaco-workbench .action-item[aria-label*="Toggle Secondary Side Bar"],
.monaco-workbench .action-label[aria-label*="Open Chat"],
.monaco-workbench .action-item[aria-label*="Open Chat"],
.monaco-workbench .action-label[aria-label*="Chat"],
.monaco-workbench .action-item[aria-label="Chat"],
.monaco-workbench .codicon-comment-discussion,
.monaco-workbench .codicon-copilot,
.monaco-workbench .codicon-chat-sparkle,
.monaco-workbench .codicon-sparkle-filled { display: none !important; }
`.trim();

/** @deprecated Prefer resolveWorkbenchShellCss — kept for tests that import the sealed CSS string shape. */
export const WORKBENCH_SHELL_CSS = WORKBENCH_SHELL_CSS_FALLBACK;

export function workbenchLaunchFromEnvironment(): { base: string; dataDir: string | null; token: string | null } | null {
  const base = Bun.env.OFFICE_CODE_SERVER_URL?.trim() ?? '';
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) return null;
  const dataDir = Bun.env.OFFICE_CODE_SERVER_DATA?.trim() || null;
  const token = Bun.env.OFFICE_CODE_SERVER_TOKEN?.trim() || null;
  return { base, dataDir, token };
}

/**
 * code-server's `?folder=` expects a path-shaped value, not a file:// URI.
 * Windows: `/F:/Development/demo_repo` (leading slash, forward slashes).
 * Raw `F:\...` becomes `F:%5C...` and fails; `file:///F:/...` yields
 * "Workspace does not exist".
 */
export function workbenchFolderQueryPath(folderPath: string): string {
  const normalized = resolve(folderPath).replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) return `/${normalized}`;
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

/** Address of the VS Code workspace for one or more connected folders. */
export function workbenchWorkspaceHref(options: {
  base: string;
  folders: readonly string[];
  filePath?: string | null;
  token?: string | null;
  dataDir?: string | null;
}): string {
  const url = new URL('/', options.base);
  if (options.token) url.searchParams.set('tkn', options.token);
  const folders = options.folders.filter(Boolean);
  if (folders.length > 1) {
    if (!options.dataDir) {
      throw new Error('Multiple connected folders need the VS Code workspace data directory.');
    }
    const workspacePath = writeMultiRootWorkspace(options.dataDir, folders);
    url.searchParams.set('workspace', workspacePath);
  } else if (folders[0]) {
    url.searchParams.set('folder', workbenchFolderQueryPath(folders[0]!));
  }
  if (options.filePath) {
    const fileUrl = pathToFileURL(options.filePath).href;
    url.searchParams.set('payload', JSON.stringify([['openFile', fileUrl]]));
  }
  return url.toString();
}

export function writeMultiRootWorkspace(dataDir: string, folders: readonly string[]): string {
  const path = join(dataDir, 'User', 'air-office.code-workspace');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    folders: folders.map((folder) => ({ path: folder })),
    settings: {}
  }, null, 2));
  return path;
}

export function fileInsideConnectedRoot(rootPath: string, filePath: string): string | null {
  if (!rootPath || !filePath || filePath.includes('\0') || isAbsolute(filePath)) return null;
  const root = resolve(rootPath);
  const full = resolve(root, filePath);
  const fromRoot = relative(root, full);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) return null;
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  try {
    const target = realpathSync(full);
    const relativeTarget = relative(realpathSync(root), target);
    if (!relativeTarget || relativeTarget === '..' || relativeTarget.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(relativeTarget)) return null;
    return target;
  } catch { return null; }
}

/** True when a folder may open in Code: an explicitly connected root only (not the Library). */
export function workbenchRootAllowed(rootPath: string, vaultRoot: string, connectedRoots: readonly string[]): boolean {
  if (!rootPath || rootPath.includes('\0')) return false;
  let requested: string;
  try {
    requested = realpathSync(resolve(rootPath));
  } catch {
    return false;
  }
  let library: string;
  try {
    library = realpathSync(resolve(vaultRoot));
  } catch {
    library = resolve(vaultRoot);
  }
  if (requested === library) return false;
  for (const connected of connectedRoots) {
    try {
      if (realpathSync(resolve(connected)) === requested) return true;
    } catch {
      if (resolve(connected) === resolve(rootPath)) return true;
    }
  }
  return false;
}

/** Pick the longest trusted root that contains an absolute file path. */
export function workbenchRootForFile(absoluteFile: string, vaultRoot: string, connectedRoots: readonly string[]): { rootPath: string; filePath: string } | null {
  if (!absoluteFile || absoluteFile.includes('\0') || !existsSync(absoluteFile) || !statSync(absoluteFile).isFile()) return null;
  let target: string;
  try { target = realpathSync(absoluteFile); } catch { return null; }
  const candidates = [vaultRoot, ...connectedRoots]
    .map((root) => {
      try { return realpathSync(resolve(root)); } catch { return resolve(root); }
    })
    .sort((left, right) => right.length - left.length);
  for (const root of candidates) {
    const relativePath = relative(root, target);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) continue;
    return { rootPath: root, filePath: relativePath };
  }
  return null;
}

/** Writes application storage flags the settings UI does not cover (for example Do Not Disturb). */
function applyWorkbenchStorageFlags(dataDir: string): void {
  const storageDir = join(dataDir, 'User', 'globalStorage');
  mkdirSync(storageDir, { recursive: true });
  const dbPath = join(storageDir, 'state.vscdb');
  const db = new Database(dbPath);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
    // true = Do Not Disturb: hide non-error bottom toast notifications.
    db.query('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)').run('notifications.doNotDisturbMode', 'true');
    // Force the secondary side bar (VS Code chat) closed even if a prior session left it open.
    db.query('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)').run('auxiliaryBar.hidden', 'true');
  } finally {
    db.close();
  }
}

function applyWorkbenchKeybindings(dataDir: string): void {
  const path = join(dataDir, 'User', 'keybindings.json');
  mkdirSync(dirname(path), { recursive: true });
  // Remove the shortcuts that reopen the secondary side bar / chat panel.
  writeFileSync(path, `${JSON.stringify([
    { key: 'ctrl+alt+b', command: '-workbench.action.toggleAuxiliaryBar' },
    { key: 'cmd+alt+b', command: '-workbench.action.toggleAuxiliaryBar' },
    { key: 'ctrl+shift+i', command: '-workbench.action.chat.open' },
    { key: 'cmd+shift+i', command: '-workbench.action.chat.open' },
    { key: 'ctrl+l', command: '-workbench.panel.chat' },
    { key: 'cmd+l', command: '-workbench.panel.chat' },
  ], null, 2)}\n`);
}

/**
 * Injects CSS into code-server's workbench.html so the secondary side bar toggle
 * cannot be shown even when a control slips past settings, and so the first
 * paint matches the AIR theme (avoids a blank white page while Monaco boots).
 *
 * Best-effort only: NSIS under Program Files makes this file read-only for
 * normal users. Never throw — failing the seal must not block Code open.
 */
export function sealWorkbenchShellHtml(
  codeServerRoot: string,
  appearance: 'light' | 'dark' = 'dark',
): boolean {
  const htmlPath = join(codeServerRoot, 'lib', 'vscode', 'out', 'vs', 'code', 'browser', 'workbench', 'workbench.html');
  if (!existsSync(htmlPath)) return false;
  try {
    const original = readFileSync(htmlPath, 'utf8');
    const chrome = resolveWorkbenchShellCss(codeServerRoot);
    // Default Dark / Light Modern surfaces — paint before workbench CSS loads.
    const paint = appearance === 'light'
      ? 'html, body { background: #ffffff !important; color-scheme: light; }'
      : 'html, body { background: #1f1f1f !important; color-scheme: dark; }';
    const css = `${chrome}\n${paint}`;
    const style = `<style id="${WORKBENCH_SHELL_STYLE_ID}">${css}</style>`;
    let next: string;
    if (original.includes(`id="${WORKBENCH_SHELL_STYLE_ID}"`)) {
      next = original.replace(/<style id="air-office-code-chrome">[\s\S]*?<\/style>/, style);
    } else if (original.includes('</head>')) {
      next = original.replace('</head>', `${style}\n\t</head>`);
    } else {
      return false;
    }
    if (next !== original) writeFileSync(htmlPath, next);
    return true;
  } catch (reason) {
    console.warn(JSON.stringify({
      component: 'workbench',
      status: 'shell-html-seal-skipped',
      error: reason instanceof Error ? reason.message : 'write failed',
    }));
    return false;
  }
}

export function applyWorkbenchAppearance(dataDir: string, appearance: 'light' | 'dark', options: { pythonInterpreter?: string | null; codeServerRoot?: string | null } = {}): void {
  const settingsPath = join(dataDir, 'User', 'settings.json');
  mkdirSync(dirname(settingsPath), { recursive: true });
  let current: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
    } catch { current = {}; }
  }
  current['workbench.colorTheme'] = appearance === 'dark' ? 'Default Dark Modern' : 'Default Light Modern';
  current['window.menuBarVisibility'] = 'hidden';
  current['window.commandCenter'] = false;
  current['chat.disableAIFeatures'] = true;
  current['chat.agent.enabled'] = false;
  current['chat.unifiedAgentsBar.enabled'] = false;
  current['chat.titleBar.openInAgentsWindow.enabled'] = false;
  // Keep layout toggles; CSS seal hides only the right / chat rail control.
  current['workbench.layoutControl.enabled'] = true;
  // code-server defaults the secondary side bar (chat) to visible when a folder is open.
  current['workbench.secondarySideBar.defaultVisibility'] = 'hidden';
  // Soft layout for the embedded Code surface; airoffice.shell shows the custom welcome.
  current['workbench.activityBar.location'] = 'top';
  current['workbench.startupEditor'] = 'none';
  current['workbench.tips.enabled'] = false;
  current['workbench.welcomePage.walkthroughs.sortOrder'] = 'none';
  current['window.restoreWindows'] = 'none';
  current['extensions.ignoreRecommendations'] = true;
  current['update.showReleaseNotes'] = false;
  const interpreter = options.pythonInterpreter?.trim();
  if (interpreter) current['python.defaultInterpreterPath'] = interpreter;
  writeFileSync(settingsPath, JSON.stringify(current, null, 2));
  applyWorkbenchStorageFlags(dataDir);
  applyWorkbenchKeybindings(dataDir);
  const codeServerRoot = options.codeServerRoot?.trim();
  if (codeServerRoot) sealWorkbenchShellHtml(codeServerRoot, appearance);
}

/** HTML that signs into code-server with the connection token, then opens the workspace href. */
export function workbenchLoginBootstrap(href: string, token: string): string {
  const target = new URL(href);
  const to = `${target.pathname}${target.search}${target.hash}` || '/';
  const login = new URL('/login', target.origin);
  login.searchParams.set('to', to);
  const password = token.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const action = login.href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>html,body{margin:0;height:100%;background:#34383e;color:#f4f5f6;}</style></head><body><form id="login" method="post" action="${action}"><input type="hidden" name="password" value="${password}"/></form><script>document.getElementById('login').submit();</script></body></html>`;
}
