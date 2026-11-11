import { describe, expect, test } from 'bun:test';
import { copilotOpenDocumentContext, leanOpenDocumentContext } from '../../../packages/providers/src/open-document-context.policy';

describe('open document context', () => {
  test('with a selection, Copilot context does not demand a full-file read first', () => {
    const text = copilotOpenDocumentContext({
      selection: 'Passage already supplied.',
      fileName: 'CGM_Paper.md',
      workspaceFilePath: 'CGM_Paper.md'
    });
    expect(text).toContain('already supplied');
    expect(text).toContain('Do not open the whole file first');
    expect(text).toContain('view_range');
    expect(text).not.toContain('read it first');
  });

  test('without a selection, note context still warns that content was not inlined', () => {
    const text = copilotOpenDocumentContext({
      fileName: 'Brief.note',
      fileId: 'note:programs/general/notes/brief.md'
    });
    expect(text).toContain('content was not sent');
    expect(text).toContain('view_range');
  });

  test('lean path with a selection prefers the supplied passage over a whole-file view', () => {
    const text = leanOpenDocumentContext({
      selection: 'Passage already supplied.',
      fileName: 'CGM_Paper.md',
      fileId: 'external:1',
      workspaceFilePath: 'CGM_Paper.md'
    });
    expect(text).toContain('Do not open the whole file first');
    expect(text).toContain('view_range');
  });
});
