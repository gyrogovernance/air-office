import { useEffect, useState } from 'react';
import type { ConversationGraph } from '@office/chat/domain';
import { activeLeaf } from '@office/chat/domain';
import type { EpisodicRecordView } from '@office/memory/domain';
import type { ServiceClient } from '../shared/service-client.hook';
import { BranchOverview } from './branch-overview.component';
import { Button, Checkbox } from '@heroui/react';
import { CollapsibleSection } from '../shared/collapsible-section.component';

interface ReasoningSnapshot {
  enabled: boolean;
  embedding: { model: string; revision: string; dimensions: number } | null;
  records: EpisodicRecordView[];
  total?: number;
}
const episodeRoles = { user: 'You', assistant: 'Assistant' } as const;

export function ReasoningPanel({ graph, leafId, appearance, client, onSelectMessage }: { graph: ConversationGraph | null; leafId: string | null; appearance?: 'light' | 'dark'; client: ServiceClient; onSelectMessage(id: string): void }) {
  const [snapshot, setSnapshot] = useState<ReasoningSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [allSaved, setAllSaved] = useState(false);
  const [page, setPage] = useState(0);
  /** Branch overview needs the full graph; the open chat keeps only a bounded window. */
  const [overviewGraph, setOverviewGraph] = useState<ConversationGraph | null>(graph);
  const conversationId = graph?.conversation.id;
  useEffect(() => {
    if (!conversationId) {
      setOverviewGraph(null);
      return;
    }
    let cancelled = false;
    void client.json<{ conversation: ConversationGraph }>(`/api/v1/conversations/${encodeURIComponent(conversationId)}`)
      .then((body) => { if (!cancelled) setOverviewGraph(body.conversation); })
      .catch(() => { if (!cancelled) setOverviewGraph(graph); });
    return () => { cancelled = true; };
  }, [client, conversationId, graph]);
  const selectedLeaf = leafId ?? (graph ? activeLeaf(graph) : null);
  const global = allSaved || !conversationId;
  const scopeQuery = !global && conversationId ? `&conversationId=${encodeURIComponent(conversationId)}${selectedLeaf ? `&leafId=${encodeURIComponent(selectedLeaf)}` : ''}` : '';
  const mutationPath = `/api/v1/reasoning${scopeQuery ? '?' + scopeQuery.slice(1) : ''}`;
  const path = `/api/v1/reasoning?offset=${page * 25}${scopeQuery}`;
  useEffect(() => { setPage(0); }, [conversationId, selectedLeaf]);
  useEffect(() => {
    setError('');
    let disposed = false;
    const controller = new AbortController();
    const refresh = async () => {
      try { const data = await client.json<ReasoningSnapshot>(path, { signal: controller.signal }); if (!disposed) { setSnapshot(data); setError(''); } }
      catch (error) { if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) setError('Reasoning is unavailable. Check that the service is up to date.'); }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 3000);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [client, path]);
  const change = async (method: 'POST' | 'DELETE', recordId: string) => {
    setBusy(true); setError('');
    try { await client.json(mutationPath, { method, body: JSON.stringify({ recordId }) }); setSnapshot(await client.json<ReasoningSnapshot>(path)); }
    catch { setError('The memory could not be updated. Please retry.'); }
    finally { setBusy(false); }
  };
  const exportDataset = async () => {
    setBusy(true); setError('');
    try {
      const response = await client.request(`/api/v1/reasoning/dataset${scopeQuery ? '?' + scopeQuery.slice(1) : ''}`);
      if (!response.ok) throw new Error('Dataset export failed.');
      const url = URL.createObjectURL(await response.blob());
      try {
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = 'air-office-exchanges.jsonl';
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
      } finally { URL.revokeObjectURL(url); }
    } catch { setError('The dataset could not be exported. Please retry.'); }
    finally { setBusy(false); }
  };
  return <section className="reasoning-panel" aria-label="Reasoning">
    <header className="reasoning-heading"><h3>Reasoning</h3><p>Human direction, remembered and carried forward.</p></header>
    {error && <p role="alert">{error}</p>}
    {!snapshot && !error && <p className="reasoning-empty" role="status">Loading saved exchanges…</p>}
    {snapshot && <>
      {conversationId && <Button variant="ghost" size="sm" onPress={() => { setAllSaved(value => !value); setPage(0); }}>{global ? 'This chat' : 'All saved exchanges'}</Button>}
      <Checkbox className="reasoning-toggle" isSelected={snapshot.enabled} isDisabled={busy} onChange={enabled => {
        setBusy(true);
        void client.json('/api/v1/memory', { method: 'PUT', body: JSON.stringify({ enabled }) }).then(() => { setSnapshot(current => current ? { ...current, enabled } : null); window.dispatchEvent(new Event('air-office:crafts-changed')); }).catch(() => setError('The memory setting could not be saved.')).finally(() => setBusy(false));
      }}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>Remember and reuse this work</Checkbox.Content></Checkbox>
      <Button variant="ghost" size="sm" isDisabled={busy} onPress={() => { void exportDataset(); }}>Export saved exchanges as JSONL</Button>
      <p className="reasoning-empty">The local dataset contains saved message text. Review personal information before sharing.</p>
      <CollapsibleSection className="reasoning-setup" title="Behind the scenes">
        <dl><dt>Capture</dt><dd>Original messages</dd><dt>Memory index</dt><dd>{snapshot.embedding ? `${snapshot.embedding.model} · ${snapshot.embedding.dimensions} dimensions` : 'Choose an embedding model in Settings'}</dd></dl>
        <p>Each user, assistant, user exchange is saved once and indexed for memory tools. Saved exchanges survive deletion of the original chat.</p>
      </CollapsibleSection>
      {!snapshot.records.length && <p className="reasoning-empty">{snapshot.enabled ? 'Memories appear after three completed messages on this branch.' : 'Memory is off. Saved records stay here; new capture and recall are paused.'}</p>}
      <div className="reasoning-records">{snapshot.records.map(record => <article className="reasoning-record" key={record.record_id}>
        <div className="reasoning-record-heading"><strong>Saved exchange</strong><small>{record.created_at.slice(0, 16).replace('T', ' ')}</small></div>
        <ol className="reasoning-episodes">
          {record.messages.map((message, index) => <li key={index}><strong>{episodeRoles[message.role]}</strong><p>{message.content}{message.truncated ? '… Preview. Export the dataset for the full text.' : ''}</p></li>)}
        </ol>
        <small>Original message text · {record.indexed ? 'Indexed' : 'Index pending'}</small>
        {record.error && <p role="status">{record.error}</p>}
        <div className="reasoning-actions">{record.sources.map((source, index) => <Button variant="ghost" size="sm" key={source.message_id} isDisabled={!graph?.messages.some(message => message.id === source.message_id)} onPress={() => onSelectMessage(source.message_id)}>Message {index + 1}</Button>)}
          {!record.indexed && <Button variant="ghost" size="sm" isDisabled={busy} onPress={() => { void change('POST', record.record_id); }}>Retry indexing</Button>}
          <Button variant="ghost" size="sm" isDisabled={busy} onPress={() => { void change('DELETE', record.record_id); }}>Forget</Button>
        </div>
      </article>)}</div>
      {(page > 0 || (snapshot.total ?? 0) > (page + 1) * 25) && <div className="reasoning-actions"><span className="reasoning-page-status" aria-live="polite">Page {page + 1} of {Math.max(1, Math.ceil((snapshot.total ?? 0) / 25))} · {snapshot.total ?? 0} saved</span><Button variant="ghost" size="sm" isDisabled={page === 0 || busy} onPress={() => setPage(value => value - 1)}>Previous</Button><Button variant="ghost" size="sm" isDisabled={(page + 1) * 25 >= (snapshot.total ?? 0) || busy} onPress={() => setPage(value => value + 1)}>Next</Button></div>}
    </>}
    {overviewGraph ? <CollapsibleSection className="reasoning-branches" title="Conversation branches"><BranchOverview appearance={appearance} graph={overviewGraph} selectedMessageId={leafId} onSelectMessage={onSelectMessage}/></CollapsibleSection> : <p>Start a conversation to see its reasoning and branches.</p>}
  </section>;
}
