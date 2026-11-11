import { expect, test } from 'bun:test';
import { CHAT_NOTE_FILE_ID_PREFIX, isChatRunContext } from '../../../../packages/contracts/src/chat/chat.contracts.public';

test('the run context carries the open document identifier alongside its name', () => {
  // The shell attaches the open document as name + id and never as content;
  // if the guard rejects fileId the whole attached-document flow silently 400s.
  expect(isChatRunContext({ fileName: 'Roadmap.note', fileId: `${CHAT_NOTE_FILE_ID_PREFIX}programs/general/notes/roadmap.md` })).toBe(true);
  expect(isChatRunContext({ fileName: 'readme.md', fileId: 'file-2' })).toBe(true);
  expect(isChatRunContext({ selection: 'a passage', fileName: 'readme.md', fileId: 'file-2' })).toBe(true);
});

test('the file identifier follows the same string rule as the rest of the context', () => {
  expect(isChatRunContext({ fileId: 42 })).toBe(false);
  expect(isChatRunContext({ fileId: ['doc-1'] })).toBe(false);
  expect(isChatRunContext({ fileId: undefined })).toBe(false);
  expect(isChatRunContext({ fileId: 'x'.repeat(100_001) })).toBe(false);
  expect(isChatRunContext({ unexpected: 'value' })).toBe(false);
});
