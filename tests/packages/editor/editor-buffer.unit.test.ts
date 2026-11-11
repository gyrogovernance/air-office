import { expect, test } from 'bun:test';
import { createDocumentBuffer, isDocumentDirty, saveDocumentBuffer } from '../../../packages/editor/src/editor.domain.public';

test('independent buffers retain their own saved contents and versions', () => {
  const a = createDocumentBuffer({ id: 'a', name: 'A', content: 'saved A', version: 'v1' }, 'draft A');
  const b = createDocumentBuffer({ id: 'b', name: 'B', content: 'saved B', version: 'v2' }, 'draft B');
  const saved = saveDocumentBuffer(a, { ...a.file, content: 'draft A', version: 'v3' });
  expect(isDocumentDirty(saved)).toBe(false);
  expect(b.content).toBe('draft B');
  expect(b.file.content).toBe('saved B');
  expect(b.file.version).toBe('v2');
  expect(isDocumentDirty(b)).toBe(true);
});
test('save completion preserves edits typed while save was pending', () => {
  const current = createDocumentBuffer({ id: 'a', name: 'A', content: 'old', version: 'v1' }, 'newer draft');
  const result = saveDocumentBuffer(current, { ...current.file, content: 'submitted draft', version: 'v2' });
  expect(result.content).toBe('newer draft');
  expect(result.file.version).toBe('v2');
  expect(isDocumentDirty(result)).toBe(true);
});
