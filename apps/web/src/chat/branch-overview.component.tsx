import { SelectField } from '../shared/select-field.component';
import { CollapsibleSection } from '../shared/collapsible-section.component';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import { Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import type { ConversationGraph } from '@office/chat/domain';
import { projectGraphOverview, readGraphOverviewPreferences, toggleFavorite, writeGraphOverviewPreferences, type GraphOverviewPreferences, type OverviewNodeData } from './graph-overview.policy';

interface MessageNodeData extends OverviewNodeData, Record<string, unknown> {
  horizontal: boolean;
  onSelect: (messageId: string) => void;
  onFavorite: (messageId: string) => void;
}

type MessageNode = Node<MessageNodeData, 'chatMessage'>;

export function BranchMessageNode({ data }: NodeProps<MessageNode>) {
  const { message } = data;
  const author = message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Assistant' : 'System';
  const preview = message.content.trim() || (message.complete ? 'Empty message' : 'Response in progress');
  return <article className={`branch-overview-node${data.selected ? ' branch-overview-node-selected' : ''}`}>
    <Handle type="target" position={data.horizontal ? Position.Left : Position.Top}/>
    <Button className="branch-overview-message nodrag" variant="ghost" aria-pressed={data.selected} aria-label={`Select ${author} message: ${preview.slice(0, 120)}`} onPress={() => data.onSelect(message.id)}>
      <strong>{author}</strong><span>{preview.slice(0, 160)}</span>
      {message.error && <small>Response failed</small>}
    </Button>
    <Button className="branch-overview-favorite nodrag" variant={data.favorite ? 'secondary' : 'tertiary'} size="sm" aria-pressed={data.favorite} aria-label={`${data.favorite ? 'Remove favorite' : 'Favorite'} message ${message.id}`} onPress={() => data.onFavorite(message.id)}>{data.favorite ? 'Favorited' : 'Favorite'}</Button>
    <Handle type="source" position={data.horizontal ? Position.Right : Position.Bottom}/>
  </article>;
}

const NODE_TYPES = { chatMessage: BranchMessageNode };

export interface BranchOverviewProps {
  graph: ConversationGraph;
  selectedMessageId: string | null;
  onSelectMessage: (messageId: string) => void;
  disabled?: boolean;
  appearance?: 'light' | 'dark';
}

function BranchOverviewCanvas({ graph, selectedMessageId, onSelectMessage, disabled = false, appearance = 'light' }: BranchOverviewProps) {
  const [preferences, setPreferences] = useState(() => readGraphOverviewPreferences(graph.conversation.id));
  const [ready, setReady] = useState(false);
  const { fitView } = useReactFlow<MessageNode>();
  const update = useCallback((next: GraphOverviewPreferences) => {
    setPreferences(next);
    writeGraphOverviewPreferences(graph.conversation.id, next);
  }, [graph.conversation.id]);
  const onFavorite = useCallback((messageId: string) => {
    setPreferences((current) => {
      const next = toggleFavorite(current, messageId);
      writeGraphOverviewPreferences(graph.conversation.id, next);
      return next;
    });
  }, [graph.conversation.id]);
  const select = useCallback((messageId: string) => {
    if (!disabled) onSelectMessage(messageId);
  }, [disabled, onSelectMessage]);
  const projection = useMemo(() => projectGraphOverview(graph, preferences, selectedMessageId), [graph, preferences, selectedMessageId]);
  const nodes: MessageNode[] = useMemo(() => projection.nodes.map((node) => ({
    ...node,
    selected: node.data.selected,
    data: { ...node.data, horizontal: preferences.layout === 'horizontal', onSelect: select, onFavorite }
  })), [projection, preferences.layout, select, onFavorite]);
  const topology = graph.messages.map((message) => `${message.id}:${message.parentId}`).join('|');

  useEffect(() => {
    if (ready && !preferences.viewportPinned) void fitView({ padding: 0.2, duration: 200 });
  }, [ready, topology, preferences.layout, preferences.viewportPinned, fitView]);

  return <section className="branch-overview" aria-label="Conversation branches">
    <div className="branch-overview-toolbar">
      <SelectField aria-label="Branch layout" value={preferences.layout} onValueChange={(selectedValue) => update({ ...preferences, layout: selectedValue === 'horizontal' ? 'horizontal' : 'vertical' })}><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option></SelectField>
      <Button variant="tertiary" size="sm" aria-pressed={preferences.viewportPinned} onPress={() => update({ ...preferences, viewportPinned: !preferences.viewportPinned })}>{preferences.viewportPinned ? 'Unpin viewport' : 'Pin viewport'}</Button>
      <Button variant="tertiary" size="sm" onPress={() => { void fitView({ padding: 0.2, duration: 200 }); }}>Fit branches</Button>
    </div>
    {graph.messages.length === 0 ? <p className="branch-overview-empty">Branches appear after the first message.</p> : <>
      <div className="branch-overview-canvas">
        <ReactFlow<MessageNode> colorMode={appearance} nodes={nodes} edges={projection.edges} nodeTypes={NODE_TYPES} onInit={() => setReady(true)} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} minZoom={0.1} maxZoom={2} fitView attributionPosition="bottom-left">
          <Background/><Controls showInteractive={false}/>
        </ReactFlow>
      </div>
      <CollapsibleSection className="branch-overview-accessible" title={`All messages · ${graph.messages.length}`}>
        <ul>{graph.messages.map((message) => <li key={message.id}>
          <Button variant="ghost" size="sm" isDisabled={disabled} aria-pressed={selectedMessageId === message.id} onPress={() => select(message.id)}>{message.role}: {message.content.trim().slice(0, 120) || 'Empty message'}</Button>
          <Button variant={preferences.favoriteMessageIds.includes(message.id) ? 'secondary' : 'tertiary'} size="sm" aria-pressed={preferences.favoriteMessageIds.includes(message.id)} aria-label={`Toggle favorite message ${message.id}`} onPress={() => onFavorite(message.id)}>{preferences.favoriteMessageIds.includes(message.id) ? 'Favorited' : 'Favorite'}</Button>
        </li>)}</ul>
      </CollapsibleSection>
      <div className="branch-overview-favorites" aria-label="Favorite messages">
        <strong>Favorites</strong>
        {graph.messages.filter((message) => preferences.favoriteMessageIds.includes(message.id)).map((message) => <Button variant="tertiary" size="sm" isDisabled={disabled} key={message.id} onPress={() => select(message.id)}>{message.content.trim().slice(0, 64) || `${message.role} message`}</Button>)}
        {!graph.messages.some((message) => preferences.favoriteMessageIds.includes(message.id)) && <span>No favorite messages yet.</span>}
      </div>
    </>}
  </section>;
}

export function BranchOverview(props: BranchOverviewProps) {
  return <ReactFlowProvider key={props.graph.conversation.id}><BranchOverviewCanvas {...props}/></ReactFlowProvider>;
}
