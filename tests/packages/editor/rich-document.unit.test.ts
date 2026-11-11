import { describe, expect, test } from 'bun:test';
import '../../support/editor-dom.adapter';
import { inboundContentToMarkdown } from '../../../packages/editor/src/rich-document-converter.domain.public';
import {
  createRichDocument,
  documentMarkdown,
  ensureNativeRichDocument,
  exportRichDocument,
  isInboundRichDocument,
  markdownToNativeBody,
  nativeBodyContentKey,
  nativeBodyToMarkdown,
  validateRichDocument,
  emptyNativeBody
} from '../../../packages/editor/src/rich-document.domain.public';

/** Round-trip a Markdown sample through Lobe and return both serializations. */
function roundTrip(source: string) {
  const once = nativeBodyToMarkdown(markdownToNativeBody(source));
  const twice = nativeBodyToMarkdown(markdownToNativeBody(once));
  return { once, twice };
}

describe('rich document native model', () => {
  test('escapes a literal backslash before a table delimiter when importing blocks', () => {
    const markdown = inboundContentToMarkdown([{ id: 'table', type: 'table', content: { type: 'tableContent', rows: [{ cells: [[{ type: 'text', text: 'a\\|b' }]] }] } }]);
    expect(markdown).toContain(String.raw`| a\\\|b |`);
  });
  test('creates versionless documents that are valid only with a native body', () => {
    const document = createRichDocument('Quick note', 'note-1');
    expect(validateRichDocument(document)).toBe(true);
    expect(document.body).toHaveProperty('root');
    // A pre-native stored note (content tree, no body) is never valid as native.
    const inbound = { ...document, body: undefined, content: { type: 'doc', content: [] } };
    expect(validateRichDocument(inbound)).toBe(false);
    expect(isInboundRichDocument(inbound)).toBe(true);
    expect(isInboundRichDocument(document)).toBe(false);
  });

  test('converts Markdown through Lobe with a stable idempotent round trip', () => {
    for (const source of [
      '# Heading\n\nA plain paragraph',
      '* Parent\n  * Nested bullet\n* Sibling\n\nAfter list',
      '| Name | Value |\n| --- | --- |\n| A | 2 |',
      '[link](https://example.com)',
      '> quote',
      '```\ncode\n```'
    ]) {
      const { once, twice } = roundTrip(source);
      expect(twice).toBe(once);
    }
  });

  test('gives every conversion of the same content the same id-stripped key', () => {
    const first = markdownToNativeBody('# Title\n\nBody');
    const second = markdownToNativeBody('# Title\n\nBody');
    expect(nativeBodyContentKey(first)).toBe(nativeBodyContentKey(second));
    const edited = markdownToNativeBody('# Title\n\nOther');
    expect(nativeBodyContentKey(edited)).not.toBe(nativeBodyContentKey(first));
  });

  test('treats an empty native body as the only valid empty document', () => {
    const document = createRichDocument('Empty', 'empty-1');
    expect(validateRichDocument(document)).toBe(true);
    expect(documentMarkdown(document).trim()).toBe('');
    expect(documentMarkdown({ ...document, body: emptyNativeBody() }).trim()).toBe('');
    // Lobe cannot hydrate an empty Markdown string; the empty body is the seed.
    expect(() => markdownToNativeBody('')).toThrow();
  });

  test('converts a stored pre-native note once and leaves the original untouched until save', async () => {
    const stored = {
      format: 'air-office.rich-document',
      id: 'inbound-1',
      title: 'Imported',
      updatedAt: new Date().toISOString(),
      attachments: [],
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Migrated Heading' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world', marks: [{ type: 'bold' }] }] }
        ]
      }
    };
    const snapshot = JSON.stringify(stored);
    const converted = await ensureNativeRichDocument(stored);
    expect(converted).not.toBeNull();
    expect(validateRichDocument(converted)).toBe(true);
    const markdown = documentMarkdown(converted!);
    expect(markdown).toContain('## Migrated Heading');
    expect(markdown).toContain('**world**');
    // The conversion never mutates the stored note; the caller saves explicitly.
    expect(JSON.stringify(stored)).toBe(snapshot);
    // A native document passes through unchanged; invalid envelopes stay null.
    expect(await ensureNativeRichDocument(converted)).toBe(converted);
    expect(await ensureNativeRichDocument({ format: 'air-office.rich-document', id: 'x', title: 'x', updatedAt: 'not-a-date', content: {} })).toBe(null);
  });

  test('unwraps a prose-sized math widget back to plain dollar text and keeps real formulas', async () => {
    const { sanitizeNativeBodyMath, isProseMistakenForMath } = await import('../../../packages/editor/src/rich-document-native-bridge.domain.public');
    expect(isProseMistakenForMath('6.3 billion were stolen from Binance, surpassing the ')).toBe(true);
    expect(isProseMistakenForMath('a+b')).toBe(false);
    expect(isProseMistakenForMath('E=mc^2')).toBe(false);

    const dirty = {
      root: {
        type: 'root',
        children: [{
          type: 'paragraph',
          children: [
            { type: 'text', text: 'Digital assets worth US', detail: 0, format: 0, mode: 'normal', style: '', version: 1 },
            { type: 'math', version: 1, code: '6.3 billion were stolen from Binance, surpassing the ' },
            { type: 'text', text: '1.5 billion hack.', detail: 0, format: 0, mode: 'normal', style: '', version: 1 },
            { type: 'math', version: 1, code: 'a+b' }
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1
        }],
        direction: null,
        format: '',
        indent: 0,
        version: 1
      }
    };
    const cleaned = sanitizeNativeBodyMath(dirty) as typeof dirty;
    const children = cleaned.root.children[0]!.children;
    expect(children.some((node) => node.type === 'math' && (node as { code?: string }).code === 'a+b')).toBe(true);
    expect(children.some((node) => node.type === 'math' && String((node as { code?: string }).code ?? '').includes('billion'))).toBe(false);
    expect(children.some((node) => node.type === 'text' && String((node as { text?: string }).text ?? '').includes('$6.3 billion'))).toBe(true);
  });

  test('exports Markdown losslessly and discloses HTML flattening and attachments', () => {
    const document = {
      ...createRichDocument('Export', 'export-1'),
      body: markdownToNativeBody('# Main Title\n\nSome **bold** text\n'),
      attachments: [{ id: 'att-1', name: 'data.txt', mediaType: 'text/plain', size: 4, dataUrl: 'data:text/plain;base64,ZGF0YQ==' }]
    };
    const markdown = exportRichDocument(document, 'markdown');
    expect(markdown.report.fidelity).toBe('lossless');
    expect(markdown.content).toContain('# Main Title');
    expect(markdown.content).toContain('**bold**');
    expect(markdown.report.warnings.some((warning) => warning.includes('attachment'))).toBe(true);

    const html = exportRichDocument(document, 'html');
    expect(html.report.fidelity).toBe('partial');
    expect(html.content).toContain('<h1>Main Title</h1>');
    expect(html.content).toContain('<strong>bold</strong>');
    expect(html.report.warnings.some((warning) => warning.includes('flattens'))).toBe(true);
  });

  test('HTML export does not turn executable Markdown link schemes into anchors', () => {
    const document = {
      ...createRichDocument('Unsafe link', 'unsafe-link'),
      body: markdownToNativeBody('[open](javascript:alert(1))')
    };
    const html = exportRichDocument(document, 'html').content;
    expect(html).not.toMatch(/<a\b[^>]*href=["']javascript:/i);
  });
});

