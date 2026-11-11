import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyWorkbenchAppearance,
  fileInsideConnectedRoot,
  resolveWorkbenchShellCss,
  sealWorkbenchShellHtml,
  registerWorkbenchShellExtension,
  stageWorkbenchShellExtension,
  WORKBENCH_SHELL_EXTENSION_FOLDER,
  workbenchShellExtensionRegistered,
  workbenchFolderQueryPath,
  workbenchLaunchFromEnvironment,
  workbenchLoginBootstrap,
  workbenchRootAllowed,
  workbenchRootForFile,
  workbenchWorkspaceHref,
  writeMultiRootWorkspace,
} from '../../../apps/service/src/workbench-file.adapter';

describe('connected folder workspace', () => {
  test('refuses a directory link to files outside the connected root', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'air-workbench-boundary-'));
    try {
      const root = join(sandbox, 'connected');
      const outside = join(sandbox, 'private');
      mkdirSync(root); mkdirSync(outside);
      writeFileSync(join(outside, 'secret.txt'), 'private');
      symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      expect(fileInsideConnectedRoot(root, 'linked/secret.txt')).toBeNull();
    } finally { rmSync(sandbox, { recursive: true, force: true }); }
  });
  test('opens the folder with the connection token on the workspace address', () => {
    const href = workbenchWorkspaceHref({
      base: 'http://127.0.0.1:40123',
      folders: ['C:\\demo_repo'],
      filePath: 'C:\\demo_repo\\research\\ashby-ui.js',
      token: 'workspace-token'
    });
    const url = new URL(href);
    expect(url.origin).toBe('http://127.0.0.1:40123');
    expect(url.searchParams.get('folder')).toBe('/C:/demo_repo');
    expect(url.searchParams.get('tkn')).toBe('workspace-token');
    expect(url.searchParams.get('payload')).toContain('openFile');
  });

  test('formats Windows folder query paths for code-server', () => {
    expect(workbenchFolderQueryPath('F:\\Development\\demo_repo')).toBe('/F:/Development/demo_repo');
    expect(workbenchFolderQueryPath('C:/Users/demo')).toBe('/C:/Users/demo');
  });

  test('opens a bare workbench when no folder is requested', () => {
    const href = workbenchWorkspaceHref({
      base: 'http://127.0.0.1:40123',
      folders: [],
      token: 'workspace-token'
    });
    const url = new URL(href);
    expect(url.origin).toBe('http://127.0.0.1:40123');
    expect(url.searchParams.get('folder')).toBeNull();
    expect(url.searchParams.get('workspace')).toBeNull();
    expect(url.searchParams.get('tkn')).toBe('workspace-token');
  });

  test('writes a multi-root workspace when several folders are connected', () => {
    const root = join(tmpdir(), `air-folder-multi-${process.pid}`);
    rmSync(root, { recursive: true, force: true });
    const href = workbenchWorkspaceHref({
      base: 'http://127.0.0.1:40123',
      folders: ['C:\\alpha', 'C:\\beta'],
      token: 'workspace-token',
      dataDir: root
    });
    const url = new URL(href);
    expect(url.searchParams.get('workspace')).toContain('air-office.code-workspace');
    expect(url.searchParams.get('folder')).toBeNull();
    const workspace = JSON.parse(readFileSync(join(root, 'User', 'air-office.code-workspace'), 'utf8')) as { folders: { path: string }[] };
    expect(workspace.folders.map((folder) => folder.path)).toEqual(['C:\\alpha', 'C:\\beta']);
    rmSync(root, { recursive: true, force: true });
  });

  test('refuses multi-root workspace addresses without a data directory', () => {
    expect(() => workbenchWorkspaceHref({
      base: 'http://127.0.0.1:40123',
      folders: ['C:\\alpha', 'C:\\beta'],
      token: 'workspace-token'
    })).toThrow(/data directory/);
  });

  test('requires the loopback workspace address and connection token from the environment', () => {
    const previousUrl = Bun.env.OFFICE_CODE_SERVER_URL;
    const previousToken = Bun.env.OFFICE_CODE_SERVER_TOKEN;
    Bun.env.OFFICE_CODE_SERVER_URL = 'http://127.0.0.1:40123';
    Bun.env.OFFICE_CODE_SERVER_TOKEN = 'workspace-token';
    expect(workbenchLaunchFromEnvironment()).toEqual({ base: 'http://127.0.0.1:40123', dataDir: null, token: 'workspace-token' });
    if (previousUrl) Bun.env.OFFICE_CODE_SERVER_URL = previousUrl;
    else delete Bun.env.OFFICE_CODE_SERVER_URL;
    if (previousToken) Bun.env.OFFICE_CODE_SERVER_TOKEN = previousToken;
    else delete Bun.env.OFFICE_CODE_SERVER_TOKEN;
  });

  test('keeps the opened file inside the connected folder', () => {
    const root = join(tmpdir(), `air-folder-workspace-${process.pid}`);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, 'research'), { recursive: true });
    writeFileSync(join(root, 'research', 'ashby-ui.js'), 'console.log(1)\n');
    expect(fileInsideConnectedRoot(root, 'research/ashby-ui.js')).toBe(join(root, 'research', 'ashby-ui.js'));
    expect(fileInsideConnectedRoot(root, '../outside.js')).toBeNull();
    // Library root alone is never a Code folder; connected roots are.
    expect(workbenchRootAllowed(root, root, [])).toBe(false);
    expect(workbenchRootAllowed(root, join(root, 'library'), [root])).toBe(true);
    expect(workbenchRootAllowed(join(root, 'research'), root, [root])).toBe(false);
    expect(workbenchRootForFile(join(root, 'research', 'ashby-ui.js'), root, [])).toEqual({
      rootPath: root,
      filePath: join('research', 'ashby-ui.js'),
    });
    rmSync(root, { recursive: true, force: true });
  });

  test('records the AIR appearance, Python interpreter, and leaves VS Code chat off', () => {
    const root = join(tmpdir(), `air-folder-settings-${process.pid}`);
    rmSync(root, { recursive: true, force: true });
    applyWorkbenchAppearance(root, 'dark', { pythonInterpreter: 'C:\\Python\\python.exe' });
    const settings = JSON.parse(readFileSync(join(root, 'User', 'settings.json'), 'utf8')) as {
      'workbench.colorTheme': string;
      'chat.disableAIFeatures': boolean;
      'workbench.layoutControl.enabled': boolean;
      'workbench.secondarySideBar.defaultVisibility': string;
      'python.defaultInterpreterPath': string;
      'workbench.activityBar.location': string;
      'workbench.startupEditor': string;
    };
    expect(settings['workbench.colorTheme']).toBe('Default Dark Modern');
    expect(settings['chat.disableAIFeatures']).toBe(true);
    expect(settings['workbench.layoutControl.enabled']).toBe(true);
    expect(settings['workbench.secondarySideBar.defaultVisibility']).toBe('hidden');
    expect(settings['python.defaultInterpreterPath']).toBe('C:\\Python\\python.exe');
    expect(settings['workbench.activityBar.location']).toBe('top');
    expect(settings['workbench.startupEditor']).toBe('none');
    const keybindings = JSON.parse(readFileSync(join(root, 'User', 'keybindings.json'), 'utf8')) as { command: string }[];
    expect(keybindings.some((binding) => binding.command === '-workbench.action.toggleAuxiliaryBar')).toBe(true);
    const db = new Database(join(root, 'User', 'globalStorage', 'state.vscdb'));
    try {
      const hidden = db.query('SELECT value FROM ItemTable WHERE key = ?').get('auxiliaryBar.hidden') as { value: string } | null;
      expect(hidden?.value).toBe('true');
    } finally {
      db.close();
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('seals workbench.html from the shell extension CSS and hides only the right rail', () => {
    const root = join(tmpdir(), `air-folder-shell-${process.pid}`);
    rmSync(root, { recursive: true, force: true });
    const htmlPath = join(root, 'lib', 'vscode', 'out', 'vs', 'code', 'browser', 'workbench', 'workbench.html');
    mkdirSync(dirname(htmlPath), { recursive: true });
    writeFileSync(htmlPath, '<!DOCTYPE html><html><head></head><body></body></html>');
    const staged = stageWorkbenchShellExtension(join(root, 'bundled-extensions'));
    expect(staged.endsWith(WORKBENCH_SHELL_EXTENSION_FOLDER)).toBe(true);
    const css = resolveWorkbenchShellCss(root);
    expect(css).toContain('part.auxiliarybar');
    expect(css).toContain('codicon-layout-sidebar-right');
    expect(css.includes('codicon-layout-sidebar-left')).toBe(false);
    expect(sealWorkbenchShellHtml(root)).toBe(true);
    const once = readFileSync(htmlPath, 'utf8');
    expect(once).toContain('air-office-code-chrome');
    expect(once).toContain('part.auxiliarybar');
    expect(once.includes('codicon-layout-sidebar-left')).toBe(false);
    expect(sealWorkbenchShellHtml(root)).toBe(true);
    expect(readFileSync(htmlPath, 'utf8')).toContain('air-office-code-chrome');
    expect(readFileSync(htmlPath, 'utf8').match(/air-office-code-chrome/g)?.length).toBe(2);
    rmSync(root, { recursive: true, force: true });
  });

  test('registers the shell extension in extensions.json so code-server can load it', () => {
    const root = join(tmpdir(), `air-folder-shell-reg-${process.pid}`);
    rmSync(root, { recursive: true, force: true });
    const extensionsDir = join(root, 'extensions');
    mkdirSync(extensionsDir, { recursive: true });
    writeFileSync(join(extensionsDir, 'extensions.json'), JSON.stringify([
      {
        identifier: { id: 'dbaeumer.vscode-eslint' },
        version: '3.0.34',
        location: { $mid: 1, path: '/tmp/eslint', scheme: 'file' },
        relativeLocation: 'dbaeumer.vscode-eslint-3.0.34',
      },
    ]));
    stageWorkbenchShellExtension(extensionsDir);
    expect(workbenchShellExtensionRegistered(extensionsDir)).toBe(false);
    // stage copies into bundled-style folder name under extensionsDir when used as destination;
    // registration expects the install folder under extensionsDir.
    const { cpSync } = require('node:fs');
    const from = join(extensionsDir, WORKBENCH_SHELL_EXTENSION_FOLDER);
    // stageWorkbenchShellExtension wrote into extensionsDir as if it were bundled-extensions
    registerWorkbenchShellExtension(extensionsDir);
    expect(workbenchShellExtensionRegistered(extensionsDir)).toBe(true);
    const catalog = JSON.parse(readFileSync(join(extensionsDir, 'extensions.json'), 'utf8')) as { identifier: { id: string }; relativeLocation: string }[];
    expect(catalog.some((entry) => entry.identifier.id === 'dbaeumer.vscode-eslint')).toBe(true);
    expect(catalog.some((entry) => entry.identifier.id === 'airoffice.shell' && entry.relativeLocation === WORKBENCH_SHELL_EXTENSION_FOLDER)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  test('builds a login bootstrap that posts the connection token', () => {
    const html = workbenchLoginBootstrap('http://127.0.0.1:40123/?folder=C%3A%5Cdemo&tkn=secret', 'secret');
    expect(html).toContain('action="http://127.0.0.1:40123/login?to=%2F%3Ffolder%3DC%253A%255Cdemo%26tkn%3Dsecret"');
    expect(html).toContain('name="password" value="secret"');
    expect(html.includes('name="redirect"')).toBe(false);
  });

  test('writes the multi-root workspace file under the workbench data directory', () => {
    const root = join(tmpdir(), `air-folder-wsfile-${process.pid}`);
    rmSync(root, { recursive: true, force: true });
    const path = writeMultiRootWorkspace(root, ['C:\\one', 'C:\\two']);
    expect(path.endsWith('air-office.code-workspace')).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8')).folders).toHaveLength(2);
    rmSync(root, { recursive: true, force: true });
  });
});
