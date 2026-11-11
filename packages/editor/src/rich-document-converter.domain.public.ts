import { markdownToNativeBody, nativeBodyToMarkdown, sanitizeNativeBodyMath } from './rich-document-native-bridge.domain.public';
import {
  RICH_DOCUMENT_FORMAT,
  isInboundRichDocument,
  validateRichDocument,
  type RichDocument,
  type RichDocumentAttachment
} from './rich-document.domain.public';

// ---------------------------------------------------------------------------
// Inbound representation.
//
// A note written before the native Lobe body was adopted still carries a
// pre-native `content`: either a tree object (the original doc tree) or a block
// array. These types and the serializer below exist ONLY so that such a note can
// be read once and converted to a native body the first time it is opened. AIR
// never writes them, they are not the document model, and nothing here versions
// or dispatches on a format number — the shape of `content` is what distinguishes
// the two inbound forms.
// ---------------------------------------------------------------------------

export type RichContent = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: RichContent[];
};

export type RichDocumentBlockStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  textColor?: string;
  backgroundColor?: string;
};

export type RichDocumentStyledText = { type: 'text'; text: string; styles?: RichDocumentBlockStyle };
export type RichDocumentLink = { type: 'link'; href: string; content: RichDocumentStyledText[] };
export type RichDocumentInlineContent = RichDocumentStyledText | RichDocumentLink;
export type RichDocumentTableCell = RichDocumentInlineContent[];
export type RichDocumentTableContent = {
  type: 'tableContent';
  columnWidths?: (number | undefined)[];
  rows: { cells: RichDocumentTableCell[] }[];
};
export type RichDocumentBlock = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: RichDocumentInlineContent[] | RichDocumentTableContent | string;
  children?: RichDocumentBlock[];
};

export type ConversionReport = { fidelity: 'lossless' | 'partial'; warnings: string[] };

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function emptyParagraph(): RichDocumentBlock {
  return { id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [], children: [] };
}

// --- Inbound → Markdown serializer (blocks → markdown) ---

function inlineToMarkdown(inlines: RichDocumentInlineContent[] | string | undefined): string {
  if (!inlines) return '';
  if (typeof inlines === 'string') return inlines;
  return inlines.map((item) => {
    if (item.type === 'link') return `[${inlineToMarkdown(item.content)}](${item.href})`;
    let text = item.text;
    const s = item.styles;
    if (s?.code) text = '`' + text + '`';
    if (s?.bold) text = '**' + text + '**';
    if (s?.italic) text = '*' + text + '*';
    if (s?.underline) text = '<u>' + text + '</u>';
    if (s?.strike) text = '~~' + text + '~~';
    return text;
  }).join('');
}

function tableToMarkdown(content: RichDocumentTableContent | undefined): string {
  if (!content || !content.rows.length) return '';
  const rows = content.rows;
  const colCount = Math.max(...rows.map((r) => r.cells.length));
  const serializeCell = (cell: RichDocumentInlineContent[]) => inlineToMarkdown(cell).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  const header = rows[0]!.cells.map(serializeCell);
  while (header.length < colCount) header.push('');
  const separator = Array.from({ length: colCount }, () => '---');
  const body = rows.slice(1).map((row) => {
    const cells = row.cells.map(serializeCell);
    while (cells.length < colCount) cells.push('');
    return '| ' + cells.join(' | ') + ' |';
  });
  return ['| ' + header.join(' | ') + ' |', '| ' + separator.join(' | ') + ' |', ...body].join('\n');
}

function inlineContentOf(block: RichDocumentBlock): string | RichDocumentInlineContent[] | undefined {
  if (typeof block.content === 'string' || Array.isArray(block.content)) return block.content;
  return undefined;
}

function blockToMarkdown(block: RichDocumentBlock, depth = 0): string {
  const indent = '  '.repeat(depth);
  const content = inlineContentOf(block);
  switch (block.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(block.props?.level ?? 1)));
      return '#'.repeat(level) + ' ' + inlineToMarkdown(content);
    }
    case 'paragraph':
      return inlineToMarkdown(content);
    case 'bulletListItem':
      return indent + '* ' + inlineToMarkdown(content) + (block.children?.length ? '\n' + block.children.map((c) => blockToMarkdown(c, depth + 1)).join('\n') : '');
    case 'numberedListItem':
      return indent + '1. ' + inlineToMarkdown(content) + (block.children?.length ? '\n' + block.children.map((c) => blockToMarkdown(c, depth + 1)).join('\n') : '');
    case 'checkListItem': {
      const checked = Boolean(block.props?.checked);
      return indent + '- [' + (checked ? 'x' : ' ') + '] ' + inlineToMarkdown(content);
    }
    case 'quote':
      return inlineToMarkdown(content).split('\n').map((line) => '> ' + line).join('\n');
    case 'codeBlock': {
      const lang = typeof block.props?.language === 'string' ? block.props.language : '';
      const raw = typeof content === 'string' ? content : inlineToMarkdown(content);
      let fence = '```';
      let label = lang;
      while (raw.includes(fence)) {
        fence += '`';
        if (!label) label = 'text';
      }
      return fence + label + '\n' + raw + '\n' + fence;
    }
    case 'divider':
      return '***';
    case 'table':
      return tableToMarkdown(block.content as RichDocumentTableContent | undefined);
    case 'image': {
      const url = String(block.props?.url ?? block.props?.previewUrl ?? '');
      const alt = typeof block.props?.alt === 'string' ? block.props.alt : '';
      return `![${alt}](${url})`;
    }
    case 'file': {
      const url = String(block.props?.url ?? '');
      const name = typeof block.props?.name === 'string' ? block.props.name : 'file';
      return `[${name}](${url})`;
    }
    default:
      return inlineToMarkdown(content);
  }
}

function blocksToMarkdown(blocks: RichDocumentBlock[]): string {
  return blocks.map((block) => blockToMarkdown(block)).join('\n\n') + '\n';
}

// --- Inbound tree → blocks (the original doc tree, read once for conversion) ---

function inboundTreeToBlocks(tree: RichContent): RichDocumentBlock[] {
  const blocks: RichDocumentBlock[] = [];

  function convertInline(nodes: RichContent[] | undefined): RichDocumentInlineContent[] {
    if (!nodes || !nodes.length) return [];
    const inlines: RichDocumentInlineContent[] = [];
    for (const node of nodes) {
      if (node.type === 'text') {
        const text = node.text ?? '';
        if (!text) continue;
        const styles: RichDocumentBlockStyle = {};
        let linkHref: string | null = null;
        for (const mark of node.marks ?? []) {
          if (mark.type === 'bold') styles.bold = true;
          else if (mark.type === 'italic') styles.italic = true;
          else if (mark.type === 'strike') styles.strike = true;
          else if (mark.type === 'code') styles.code = true;
          else if (mark.type === 'link' && mark.attrs?.href) linkHref = String(mark.attrs.href);
          else if (mark.type === 'highlight' && mark.attrs?.color) styles.backgroundColor = String(mark.attrs.color);
        }
        const styledText: RichDocumentStyledText = { type: 'text', text, ...(Object.keys(styles).length ? { styles } : {}) };
        if (linkHref) inlines.push({ type: 'link', href: linkHref, content: [styledText] });
        else inlines.push(styledText);
      } else if (node.type === 'hardBreak') {
        inlines.push({ type: 'text', text: '\n' });
      }
    }
    return inlines;
  }

  function convertNodeToBlock(node: RichContent): RichDocumentBlock {
    const id = crypto.randomUUID();
    if (node.type === 'heading') {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 1)));
      return { id, type: 'heading', props: { level }, content: convertInline(node.content), children: [] };
    }
    if (node.type === 'horizontalRule') {
      return { id, type: 'divider', props: {}, content: undefined, children: [] };
    }
    if (node.type === 'codeBlock') {
      const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      const rawText = (node.content ?? []).map((c) => c.text ?? '').join('');
      return { id, type: 'codeBlock', props: { language: lang }, content: [{ type: 'text', text: rawText, styles: {} }], children: [] };
    }
    if (node.type === 'blockquote') {
      const inlineChildren = (node.content ?? []).flatMap((child) => convertInline(child.content));
      return { id, type: 'quote', props: {}, content: inlineChildren, children: [] };
    }
    if (node.type === 'table') {
      const rows: { cells: RichDocumentTableCell[] }[] = [];
      for (const rowNode of node.content ?? []) {
        const cells: RichDocumentTableCell[] = [];
        for (const cellNode of rowNode.content ?? []) cells.push(convertInline(cellNode.content?.[0]?.content));
        rows.push({ cells });
      }
      return { id, type: 'table', props: {}, content: { type: 'tableContent', columnWidths: [], rows }, children: [] };
    }
    return { id, type: 'paragraph', props: {}, content: convertInline(node.content), children: [] };
  }

  for (const node of tree.content ?? []) {
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const isOrdered = node.type === 'orderedList';
      for (const item of node.content ?? []) {
        const itemFirst = item.content?.[0];
        const itemRest = item.content?.slice(1) ?? [];
        blocks.push({
          id: crypto.randomUUID(),
          type: isOrdered ? 'numberedListItem' : 'bulletListItem',
          props: {},
          content: convertInline(itemFirst?.content),
          children: itemRest.map(convertNodeToBlock)
        });
      }
    } else {
      blocks.push(convertNodeToBlock(node));
    }
  }

  return blocks;
}

/**
 * Turn pre-native `content` (a tree object or a block array) into Markdown so it
 * can be handed to Lobe's headless kernel. The shape of `content` selects the
 * path — there is no version number involved.
 */
export function inboundContentToMarkdown(content: unknown): string {
  if (Array.isArray(content)) {
    const blocks = content.filter((b): b is RichDocumentBlock => object(b));
    return blocksToMarkdown(blocks.length ? blocks : [emptyParagraph()]);
  }
  if (object(content)) {
    const blocks = inboundTreeToBlocks(content as RichContent);
    return blocksToMarkdown(blocks.length ? blocks : [emptyParagraph()]);
  }
  return '\n';
}

/**
 * One-time bootstrap: convert a stored note to a canonical native document.
 * Returns the note unchanged if it is already native, or `null` if it is neither
 * native nor convertible (the caller keeps the original untouched).
 */
export async function ensureNativeRichDocument(raw: unknown): Promise<RichDocument | null> {
  if (validateRichDocument(raw)) {
    const body = sanitizeNativeBodyMath(raw.body);
    return body === raw.body ? raw : { ...raw, body };
  }
  if (!isInboundRichDocument(raw)) return null;
  const record = raw as {
    id: string;
    title: string;
    updatedAt: string;
    content: unknown;
    attachments?: RichDocumentAttachment[];
  };
  try {
    const markdown = inboundContentToMarkdown(record.content);
    const body = markdownToNativeBody(markdown);
    if (!object(body)) return null;
    return {
      format: RICH_DOCUMENT_FORMAT,
      id: record.id,
      title: record.title,
      updatedAt: record.updatedAt,
      body,
      attachments: Array.isArray(record.attachments) ? record.attachments : []
    };
  } catch {
    // A conversion that throws never overwrites the note: the original stays.
    return null;
  }
}

// --- Native export (native body → markdown / html) ---

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeHtmlHref(value: string): string | null {
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://air-office.invalid');
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function inlineHtml(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
    const safeHref = safeHtmlHref(href);
    return safeHref ? `<a href="${safeHref}">${label}</a>` : label;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return out;
}

function splitRow(line: string): string[] {
  const source = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return source.split('|').map((cell) => cell.trim());
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let i = 0;
  const isHr = (line: string) => /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim());
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) { code.push(lines[i]!); i++; }
      i++;
      out.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)/);
    if (heading) {
      const n = heading[1]!.length;
      out.push(`<h${n}>${inlineHtml(heading[2]!)}</h${n}>`);
      i++;
      continue;
    }
    if (isHr(line)) { out.push('<hr>'); i++; continue; }
    if (line.startsWith('> ')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('> ')) { quote.push(lines[i]!.slice(2)); i++; }
      out.push(`<blockquote><p>${inlineHtml(quote.join(' '))}</p></blockquote>`);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i + 1]!)) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) { rows.push(splitRow(lines[i]!)); i++; }
      let table = '<table><thead><tr>' + header.map((c) => `<th>${inlineHtml(c)}</th>`).join('') + '</tr></thead><tbody>';
      for (const row of rows) table += '<tr>' + row.map((c) => `<td>${inlineHtml(c)}</td>`).join('') + '</tr>';
      out.push(table + '</tbody></table>');
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*+]\s+/, '').replace(/^\[( |x|X)\]\s+/, ''));
        i++;
      }
      out.push('<ul>' + items.map((item) => `<li>${inlineHtml(item)}</li>`).join('') + '</ul>');
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) { items.push(lines[i]!.replace(/^\s*\d+\.\s+/, '')); i++; }
      out.push('<ol>' + items.map((item) => `<li>${inlineHtml(item)}</li>`).join('') + '</ol>');
      continue;
    }
    const para: string[] = [line];
    i++;
    while (
      i < lines.length && lines[i]!.trim() && !isHr(lines[i]!) &&
      !/^(#{1,6}\s|```|>\s|[-*+]\s|\d+\.\s|!\[|\|)/.test(lines[i]!)
    ) {
      para.push(lines[i]!);
      i++;
    }
    out.push(`<p>${inlineHtml(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

export type RichExportResult = { content: string; report: ConversionReport };

/**
 * Export a native document. Markdown goes straight through Lobe (lossless);
 * HTML is derived from that Markdown and flattens structure, which the report
 * discloses. Neither path reconstructs the document by hand.
 */
export function exportRichDocument(document: RichDocument, format: 'markdown' | 'html'): RichExportResult {
  const warnings: string[] = [];
  if (document.attachments.length) {
    warnings.push(`${document.attachments.length} attachment(s) stay in the canonical document and are not embedded in ${format}.`);
  }
  const markdown = nativeBodyToMarkdown(document.body);
  if (format === 'markdown') {
    return { content: markdown, report: { fidelity: 'lossless', warnings } };
  }
  warnings.unshift('HTML export flattens document structure that Markdown keeps; export JSON for the canonical copy.');
  return { content: markdownToHtml(markdown), report: { fidelity: 'partial', warnings } };
}

/** Markdown for a native document, straight from Lobe's lossless serializer. */
export function documentMarkdown(document: RichDocument): string {
  return nativeBodyToMarkdown(document.body);
}
