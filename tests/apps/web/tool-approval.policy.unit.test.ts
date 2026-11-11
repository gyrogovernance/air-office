import { expect, test } from 'bun:test';
import { toolApprovalCopy } from '../../../apps/web/src/shared/tool-approval.policy';

test('shell approvals lead with intention and keep the command as detail', () => {
  const copy = toolApprovalCopy('shell', {
    command: 'Get-ChildItem "C:\\Users\\vasil\\AppData\\Local\\AIR Office\\Data\\private\\files"',
    intention: 'List files in the AIR Office workspace to verify file tools.',
  });
  expect(copy.title).toBe('Allow this terminal command?');
  expect(copy.message).toContain('List files in the AIR Office workspace');
  expect(copy.message).not.toContain('Get-ChildItem');
  expect(copy.detail).toContain('Get-ChildItem');
  expect(copy.detailLabel).toBe('Command');
  expect(copy.confirmLabel).toBe('Allow');
});

test('shell approvals without intention still explain the ask in plain language', () => {
  const copy = toolApprovalCopy('powershell', {
    command: 'echo "AIR Office desktop app test - PowerShell working"',
  });
  expect(copy.message).toContain('terminal command');
  expect(copy.detail).toContain('echo');
  expect(copy.detailLabel).toBe('PowerShell');
});

test('write redirections mark the confirmation as destructive', () => {
  const copy = toolApprovalCopy('shell', {
    command: 'echo hi > out.txt',
    intention: 'Write a smoke-test file.',
    hasWriteFileRedirection: true,
  });
  expect(copy.destructive).toBe(true);
  expect(copy.message).toContain('create or overwrite');
});

test('file writes and reads show path context instead of raw protocol JSON', () => {
  const write = toolApprovalCopy('write', {
    fileName: 'notes/plan.md',
    intention: 'Update the plan with the test results.',
    diff: '@@ -1 +1 @@\n-old\n+new\n',
  });
  expect(write.title).toBe('Update this file?');
  expect(write.message).toContain('Update the plan');
  expect(write.detail).toContain('+new');

  const read = toolApprovalCopy('read', { path: 'notes/plan.md', intention: 'Read the plan before editing.' });
  expect(read.title).toBe('Allow reading this file?');
  expect(read.detail).toBe('notes/plan.md');
});

test('create edit and apply ask in plain language without vault jargon', () => {
  const create = toolApprovalCopy('create', { path: 'programs/general/notes/edge-ask-allow.md' });
  expect(create.title).toBe('Create this file?');
  expect(create.message).toBe('Create edge-ask-allow.md in your workspace.');
  expect(create.message.toLowerCase()).not.toContain('vault');
  expect(create.confirmLabel).toBe('Create');

  const edit = toolApprovalCopy('edit', { path: 'programs/general/notes/plan.md' });
  expect(edit.title).toBe('Edit this file?');
  expect(edit.message).toContain('Update plan.md');
  expect(edit.message.toLowerCase()).not.toContain('vault');

  const apply = toolApprovalCopy('apply_markdown_note', { path: 'programs/general/notes/edge-apply-chat.md' });
  expect(apply.title).toBe('Update this note?');
  expect(apply.message).toContain('edge-apply-chat.md');
  expect(apply.message.toLowerCase()).not.toContain('vault');
  expect(apply.confirmLabel).toBe('Update note');

  const del = toolApprovalCopy('delete', { path: 'programs/general/notes/scratch.md' });
  expect(del.title).toBe('Delete this file?');
  expect(del.message).toBe('Remove scratch.md from your workspace.');
  expect(del.message.toLowerCase()).not.toContain('vault');
  expect(del.destructive).toBe(true);

  const move = toolApprovalCopy('move', { path: 'programs/general/notes/a.md', to: 'programs/general/notes/b.md' });
  expect(move.title).toBe('Move this file?');
  expect(move.message).toContain('Move a.md');
  expect(move.message.toLowerCase()).not.toContain('vault');
});
