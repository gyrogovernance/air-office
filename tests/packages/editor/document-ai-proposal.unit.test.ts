import { describe, expect, test } from 'bun:test';
import { createRichDocument } from '@office/editor/rich-document-domain';
import {
  applyProposalToEditor,
  createDocumentAIProposal,
  isProposalStale
} from '../../../packages/editor/src/document-ai-proposal.domain.public';
import { markdownToNativeBody } from '../../../packages/editor/src/rich-document-native-bridge.domain.public';

function note(markdown: string, id = 'doc-1') {
  return { ...createRichDocument('Note', id), body: markdownToNativeBody(markdown) };
}

describe('document AI proposals (native body)', () => {
  test('createDocumentAIProposal hashes the native body', () => {
    const document = note('Hello world');
    const proposal = createDocumentAIProposal({
      document,
      scope: 'selection',
      targetNodeIds: ['n1'],
      beforeText: 'Hello world',
      afterText: 'Hello AIR',
      proposedMarkdown: 'Hello AIR'
    });
    expect(proposal.documentId).toBe(document.id);
    expect(proposal.proposedMarkdown).toBe('Hello AIR');
    expect(proposal.contentHash.length).toBeGreaterThan(0);
    expect(isProposalStale(proposal, document)).toBe(false);
  });

  test('isProposalStale when the body changes', () => {
    const document = note('Original');
    const proposal = createDocumentAIProposal({
      document,
      scope: 'document',
      beforeText: '',
      afterText: 'Revised',
      proposedMarkdown: 'Revised'
    });
    const changed = { ...document, body: markdownToNativeBody('Changed'), updatedAt: new Date().toISOString() };
    expect(isProposalStale(proposal, changed)).toBe(true);
  });

  test('applyProposalToEditor rewrites a unique selection', () => {
    const calls: string[] = [];
    const editor = {
      getDocument: () => 'Before Selected phrase After',
      getLexicalEditor: () => null,
      setDocument: (_type: string, content: string) => { calls.push(content); }
    };
    const proposal = createDocumentAIProposal({
      document: note('Before Selected phrase After'),
      scope: 'selection',
      beforeText: 'Selected phrase',
      afterText: 'Revised phrase',
      proposedMarkdown: 'Revised phrase'
    });
    applyProposalToEditor(editor, proposal);
    expect(calls).toEqual(['Before Revised phrase After']);
  });

  test('applyProposalToEditor rejects ambiguous selection anchors', () => {
    const editor = {
      getDocument: () => 'Same text and Same text',
      getLexicalEditor: () => null,
      setDocument: () => undefined
    };
    const proposal = createDocumentAIProposal({
      document: note('Same text and Same text'),
      scope: 'selection',
      beforeText: 'Same text',
      afterText: 'Changed',
      proposedMarkdown: 'Changed'
    });
    expect(() => applyProposalToEditor(editor, proposal)).toThrow(/more than once/);
  });
});
