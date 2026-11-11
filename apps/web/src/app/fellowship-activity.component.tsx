import type { ConversationSummary } from '@office/chat/domain';
import { useEffect, useState } from 'react';
import type { WorkspaceNode } from '@office/workspace/domain';
import { Button, Card } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { File01Icon, Folder01Icon, Message01Icon } from '@hugeicons/core-free-icons';
import { createServiceClient } from '../shared/service-client.hook';

export function FellowshipActivity({ scopeId, onOpenNote, onOpenProject, chats, onOpenChat }: {
  chats: ConversationSummary[];
  onOpenChat?: (id: string) => void;
  scopeId: string;
  onOpenNote: (id: string) => void;
  onOpenProject: (id: string) => void;
}) {
  const [nodes, setNodes] = useState<WorkspaceNode[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const client = createServiceClient();
    const refresh = () => void client.json<{ nodes: WorkspaceNode[] }>('/api/v1/workspace/nodes', { signal: controller.signal })
      .then(({ nodes }) => { if (!controller.signal.aborted) { setNodes(nodes); setError(''); } })
      .catch(() => { if (!controller.signal.aborted) setError('Your work could not be loaded.'); });
    refresh();
    window.addEventListener('office-workspace-changed', refresh);
    return () => { controller.abort(); window.removeEventListener('office-workspace-changed', refresh); };
  }, [scopeId]);
  const descendants = new Set(scopeId ? [scopeId] : []);
  for (let pass = 0; pass < nodes.length; pass++) {
    const before = descendants.size;
    for (const node of nodes) if (node.parentId && descendants.has(node.parentId)) descendants.add(node.id);
    if (before === descendants.size) break;
  }
  const recent = nodes.filter(node => scopeId ? node.kind === 'note' && descendants.has(node.id) : node.kind === 'project')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  const conversations = chats.filter(chat => !chat.archivedAt && chat.folderId && descendants.has(chat.folderId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  return <div className="fellowship-recent">
    {error && <p role="alert">{error}</p>}
    {recent.map(node => <Card variant="secondary" key={node.id} className="fellowship-recent-item">
      <span className="fellowship-recent-icon" data-kind={node.kind} aria-hidden="true"><HugeiconsIcon icon={node.kind === 'note' ? File01Icon : Folder01Icon} size={19} /></span><div><Card.Title>{node.name}</Card.Title><Card.Description>{node.kind === 'note' ? 'Document' : 'Project'} · {new Date(node.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Card.Description></div>
      <Button size="sm" variant="secondary" onPress={() => node.kind === 'note' ? onOpenNote(node.targetId) : onOpenProject(node.id)}>Open</Button>
    </Card>)}
    {onOpenChat && conversations.map(chat => <Card variant="secondary" key={chat.id} className="fellowship-recent-item"><span className="fellowship-recent-icon" data-kind="chat" aria-hidden="true"><HugeiconsIcon icon={Message01Icon} size={19} /></span><div><Card.Title>{chat.title}</Card.Title><Card.Description>Conversation · {chat.messageCount} messages</Card.Description></div><Button size="sm" variant="secondary" onPress={() => onOpenChat(chat.id)}>Open</Button></Card>)}
    {!error && scopeId && !recent.length && !conversations.length && <p className="text-sm text-muted">Your saved work will appear here.</p>}
  </div>;
}
