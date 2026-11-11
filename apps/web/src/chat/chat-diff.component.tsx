import { Fragment, useMemo } from 'react';
import { diffStats, pairDiffLines, parseUnifiedDiff, type DiffPair } from './chat-rendering.policy';

function cellSide(pair: DiffPair, side: 'left' | 'right'): string {
  if (pair.kind === 'context') return 'context';
  const cell = side === 'left' ? pair.left : pair.right;
  if (!cell) return 'empty';
  return side === 'left' ? 'del' : 'add';
}

/**
 * Side-by-side rendering for diff code fences (CHAT-102).
 *
 * Parses the unified diff, pairs deletion and addition runs into aligned rows,
 * and shows an addition/removal count above the two columns.
 */
export function ChatDiffView(props: { code: string }) {
  const lines = useMemo(() => parseUnifiedDiff(props.code), [props.code]);
  const pairs = useMemo(() => pairDiffLines(lines), [lines]);
  const stats = useMemo(() => diffStats(lines), [lines]);
  return <figure className="chat-diff">
    <div className="chat-diff-head">
      <span>Side-by-side diff</span>
      <span className="chat-diff-stats"><b data-kind="add">{`+${stats.added}`}</b><b data-kind="del">{`-${stats.removed}`}</b></span>
    </div>
    <div className="chat-diff-body">
      {pairs.map((pair, index) => pair.kind === 'meta'
        ? <div className="chat-diff-meta" key={index}><code>{pair.left?.text ?? ''}</code></div>
        : <Fragment key={index}>
            <div className="chat-diff-cell" data-side={cellSide(pair, 'left')}>
              <span className="chat-diff-no">{pair.left?.no ?? ''}</span><code>{pair.left?.text ?? ''}</code>
            </div>
            <div className="chat-diff-cell" data-side={cellSide(pair, 'right')}>
              <span className="chat-diff-no">{pair.right?.no ?? ''}</span><code>{pair.right?.text ?? ''}</code>
            </div>
          </Fragment>)}
    </div>
  </figure>;
}
