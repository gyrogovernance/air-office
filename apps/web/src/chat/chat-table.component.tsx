import { useState, type ReactNode } from 'react';
import { MarkdownTable, markdownTableRowCount } from '../shared/markdown-table.component';
import { rowsToCsv, tableRowsFromNode, type HastNode } from './chat-rendering.policy';

type ExportState = 'idle' | 'exported' | 'copied' | 'failed';

/**
 * Chat tables reuse the shared Guides HeroUI MarkdownTable. CSV export is the
 * only chat-specific chrome on top of that shared table.
 */
export function ChatTable(props: { node?: unknown; children?: ReactNode }) {
  const table = tableRowsFromNode(props.node as HastNode | undefined);
  const rowCount = table?.rows.length ?? markdownTableRowCount(props.children);
  const [state, setState] = useState<ExportState>('idle');
  const exportCsv = async () => {
    if (!table) return;
    const csv = rowsToCsv(table.headers, table.rows);
    try {
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'table.csv';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setState('exported');
        return;
      }
      await navigator.clipboard.writeText(csv);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  const label = state === 'exported' ? 'Exported CSV'
    : state === 'copied' ? 'Copied CSV'
    : state === 'failed' ? 'Export failed'
    : 'Export CSV';

  return <figure className="chat-table-wrap">
    {rowCount > 0 ? <div className="chat-table-actions">
      <span className="chat-table-meta">{`${rowCount} rows`}</span>
      {table ? <span
        className="markdown-code-block-copy"
        role="button"
        tabIndex={0}
        data-state={state}
        aria-label="Export table as CSV"
        onClick={() => void exportCsv()}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void exportCsv(); } }}
      >{label}</span> : null}
    </div> : null}
    <MarkdownTable>{props.children}</MarkdownTable>
  </figure>;
}
