import { expect, test } from 'bun:test';
import { airFilePath, connectedFileTarget, isVaultNotePath, linkifyWorkspacePaths, resolveWorkspaceOpenTarget, toolWorkspacePath, workspaceFileLabel, workspaceFileTouches } from '../../../../apps/web/src/chat/workspace-file-link.policy';

const roots = [
  { id: 'demo', name: 'demo_repo', path: 'C:\\Users\\Example\\Documents\\demo_repo', connectedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'docs', name: 'Documents', path: 'C:\\Users\\Example\\Documents', connectedAt: '2026-01-01T00:00:00.000Z' },
];

test('toolWorkspacePath reads create/write/edit/view paths from args', () => {
  expect(toolWorkspacePath('create', { path: 'C:\\Users\\Example\\Documents\\demo_repo\\sample.md' }, undefined)).toBe('C:\\Users\\Example\\Documents\\demo_repo\\sample.md');
  expect(toolWorkspacePath('write', { filePath: '/tmp/notes/a.md' }, { ok: true })).toBe('/tmp/notes/a.md');
  expect(toolWorkspacePath('web_search', { path: 'C:\\Users\\Example\\Documents\\demo_repo\\sample.md' }, undefined)).toBeNull();
});

test('connectedFileTarget prefers the longest matching connected root', () => {
  expect(connectedFileTarget('C:\\Users\\Example\\Documents\\demo_repo\\markdown-styles-sample.md', roots)).toEqual({
    rootId: 'demo',
    path: 'markdown-styles-sample.md',
  });
  expect(connectedFileTarget('C:/Users/Example/Documents/other/readme.md', roots)).toEqual({
    rootId: 'docs',
    path: 'other/readme.md',
  });
  expect(connectedFileTarget('D:\\elsewhere\\file.md', roots)).toBeNull();
});

test('connectedFileTarget accepts a relative path only when one root is connected', () => {
  expect(connectedFileTarget('nested/file.md', roots)).toBeNull();
  expect(connectedFileTarget('nested/file.md', [roots[0]!])).toEqual({ rootId: 'demo', path: 'nested/file.md' });
});

test('resolveWorkspaceOpenTarget opens vault-relative notes when connected folders do not match', () => {
  expect(isVaultNotePath('programs/general/notes/plan.md')).toBe(true);
  expect(resolveWorkspaceOpenTarget('programs/general/notes/plan.md', roots)).toEqual({
    kind: 'vault-note',
    path: 'programs/general/notes/plan.md',
  });
  expect(resolveWorkspaceOpenTarget('automations/demo.automation.yaml', roots)).toEqual({
    kind: 'vault-file',
    path: 'automations/demo.automation.yaml',
  });
  expect(resolveWorkspaceOpenTarget('C:\\Users\\Example\\Documents\\demo_repo\\readme.md', roots)).toEqual({
    kind: 'connected',
    target: { rootId: 'demo', path: 'readme.md' },
  });
});

test('linkifyWorkspacePaths turns absolute paths into air-file markdown links', () => {
  const linked = linkifyWorkspacePaths('Created C:\\Users\\Example\\Documents\\demo_repo\\markdown-styles-sample.md with samples.');
  expect(linked).toContain('[markdown-styles-sample.md](air-file:');
  expect(airFilePath(linked.match(/\(air-file:[^)]+\)/)?.[0]?.slice(1, -1) ?? null)).toBe('C:\\Users\\Example\\Documents\\demo_repo\\markdown-styles-sample.md');
});

test('workspaceFileLabel keeps the basename for link text', () => {
  expect(workspaceFileLabel('C:\\Users\\Example\\Documents\\demo_repo\\markdown-styles-sample.md')).toBe('markdown-styles-sample.md');
  expect(workspaceFileLabel('/tmp/notes/a.md')).toBe('a.md');
});

test('workspaceFileTouches keeps successful create and edit paths for the reply footer', () => {
  expect(workspaceFileTouches([
    { name: 'view', arguments: { path: 'C:\\Users\\Example\\Documents\\demo_repo\\readme.md' }, status: 'ok' },
    { name: 'create', arguments: { path: 'C:\\Users\\Example\\Documents\\demo_repo\\markdown-styles-sample.md' }, status: 'ok' },
    { name: 'edit', arguments: { path: 'C:\\Users\\Example\\Documents\\demo_repo\\markdown-styles-sample.md' }, status: 'ok' },
    { name: 'write', arguments: { path: 'C:\\Users\\Example\\Documents\\demo_repo\\other.md' }, status: 'running' },
  ])).toEqual([
    { path: 'C:\\Users\\Example\\Documents\\demo_repo\\markdown-styles-sample.md' },
  ]);
});
