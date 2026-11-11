import { Children, isValidElement, useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactElement, type ReactNode } from 'react';
import { Table } from '@heroui/react';
import { defaultComponents, type ExtraProps } from 'streamdown';

type MarkdownCodeProps = ComponentPropsWithoutRef<'code'> & {
  'data-block'?: boolean;
} & ExtraProps;
const DefaultMarkdownCode = defaultComponents.code;

function markdownText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  return Children.toArray(children).map((child) => isValidElement<{ children?: ReactNode }>(child) ? markdownText(child.props.children) : '').join('');
}

function MarkdownCode({ children, className, node, 'data-block': dataBlock }: MarkdownCodeProps) {
  // Inline code uses our prose styles. Streamdown's default only ships Tailwind utilities.
  if (dataBlock === undefined) {
    return <code className={['markdown-inline-code', className].filter(Boolean).join(' ')} data-streamdown="inline-code">{children}</code>;
  }

  const code = markdownText(children);
  const languageClass = node?.properties?.className?.find((name) => name.startsWith('language-'));
  const language = languageClass?.slice('language-'.length) ?? className?.split(' ').find((name) => name.startsWith('language-'))?.slice('language-'.length) ?? 'text';
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return <div className="markdown-code-block">
    <div className="markdown-code-block-bar">
      <span>{language}</span>
      <span
        className="markdown-code-block-copy"
        role="button"
        tabIndex={0}
        aria-label={copied ? 'Code copied' : 'Copy code'}
        onClick={() => void copy()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy(); } }}
      >
        {copied ? 'Copied' : 'Copy'}
      </span>
    </div>
    <div className="markdown-code-block-content"><DefaultMarkdownCode className={className} node={node} data-block={dataBlock} {...{ children }}/></div>
  </div>;
}

type MarkdownElement = ReactElement<{ node?: { tagName?: string; properties?: { align?: unknown } }; children?: ReactNode }>;

function cellAlignment(cell: MarkdownElement): "left" | "center" | "right" | undefined {
  const align = cell.props.node?.properties?.align;
  return align === "left" || align === "center" || align === "right" ? align : undefined;
}

export function markdownTableElements(children: ReactNode, tagName: string): MarkdownElement[] {
  return Children.toArray(children).filter((child): child is MarkdownElement =>
    isValidElement<{ node?: { tagName?: string; properties?: { align?: unknown } }; children?: ReactNode }>(child) && child.props.node?.tagName === tagName);
}

/** Row count from Streamdown table children when the hast node is unavailable. */
export function markdownTableRowCount(children: ReactNode): number {
  const body = markdownTableElements(children, 'tbody')[0];
  return body ? markdownTableElements(body.props.children, 'tr').length : 0;
}

/** Adapt Markdown's parsed rows to HeroUI's collection without flattening cell content. */
export function MarkdownTable({ children }: { children?: ReactNode }) {
  const head = markdownTableElements(children, 'thead')[0];
  const body = markdownTableElements(children, 'tbody')[0];
  const headerRow = head && markdownTableElements(head.props.children, 'tr')[0];
  const columns = headerRow ? markdownTableElements(headerRow.props.children, 'th') : [];
  const rows = body ? markdownTableElements(body.props.children, 'tr') : [];
  const cells = rows.map((row) => markdownTableElements(row.props.children, 'td'));
  if (!columns.length || cells.some((row) => row.length !== columns.length)) {
    return <div className="markdown-table-fallback"><table>{children}</table></div>;
  }
  return <Table variant="secondary">
    <Table.ScrollContainer>
      <Table.Content aria-label="Document table">
        <Table.Header>{columns.map((column, index) => <Table.Column key={index} isRowHeader={index === 0} style={{ textAlign: cellAlignment(column) }}>{column.props.children}</Table.Column>)}</Table.Header>
        <Table.Body>{cells.map((row, rowIndex) => <Table.Row key={rowIndex}>{row.map((cell, index) => <Table.Cell key={index} style={{ textAlign: cellAlignment(cell) }}>{cell.props.children}</Table.Cell>)}</Table.Row>)}</Table.Body>
      </Table.Content>
    </Table.ScrollContainer>
  </Table>;
}

type MarkdownImageProps = ComponentPropsWithoutRef<'img'> & ExtraProps;

/**
 * Plain image without Streamdown's wrapper chrome. Missing or broken sources
 * render nothing so chat and Guides do not show empty image blocks.
 */
function MarkdownImage({ node: _node, className, onError, ...props }: MarkdownImageProps) {
  const [failed, setFailed] = useState(false);
  if (!props.src || failed) return null;
  return <img
    {...props}
    className={['markdown-image', className].filter(Boolean).join(' ')}
    data-streamdown="image"
    onError={(event) => {
      setFailed(true);
      onError?.(event);
    }}
  />;
}

export const MARKDOWN_COMPONENTS = { code: MarkdownCode, table: MarkdownTable, img: MarkdownImage };
