import { useEffect, useMemo, useState } from 'react';
import { Card, Button, Separator } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Folder01Icon } from '@hugeicons/core-free-icons';
import type { ConnectedRoot } from '@office/files/domain';
import type { WorkspaceNode } from '@office/workspace/domain';
import { createServiceClient } from '../shared/service-client.hook';
import { useAppDialogs } from '../shared/app-dialogs.component';

export function LocalFoldersSettings({ onChanged, onOpenPrograms }: { onChanged?: () => Promise<void>; onOpenPrograms?: (scopeId?: string) => void }) {
  const client = useMemo(() => createServiceClient(), []);
  const dialogs = useAppDialogs();
  const [roots, setRoots] = useState<ConnectedRoot[]>([]);
  const [nodes, setNodes] = useState<WorkspaceNode[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  async function refresh() {
    const [folders, catalog] = await Promise.all([client.json<{ roots: ConnectedRoot[] }>('/api/v1/external/roots'), client.json<{ nodes: WorkspaceNode[] }>('/api/v1/workspace/nodes')]);
    setRoots(folders.roots); setNodes(catalog.nodes);
  }
  useEffect(() => { void refresh().catch(() => setError('Local folders could not be loaded.')).finally(() => setLoading(false)); }, [client]);
  async function disconnect(root: ConnectedRoot) {
    if (!await dialogs.confirm({ title: 'Disconnect folder?', message: `Remove access to ${root.name}? Its files stay on disk.`, confirmLabel: 'Disconnect' })) return;
    setBusy(true); setError('');
    try { await client.json(`/api/v1/external/roots/${encodeURIComponent(root.id)}`, { method: 'DELETE' }); await refresh(); await onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The folder could not be disconnected.'); }
    finally { setBusy(false); }
  }
  return <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Local folders">
    <Card.Header><Card.Title className="settings-block-heading" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={Folder01Icon} size={18} aria-hidden="true" />Programs</Card.Title></Card.Header><Separator />
    <Button variant="secondary" size="sm" onPress={() => onOpenPrograms?.()}>Open Programs</Button>
    <h4>Connected folders</h4>
    <p className="settings-pref-help">Disconnecting removes Office access. Files stay on your computer.</p>
    {loading && <p role="status">Loading local folders…</p>}
    {!loading && roots.length === 0 && <p className="settings-pref-help">No folders connected.</p>}
    {roots.map((root) => {
      const mounts = nodes.filter((node) => node.kind === 'mount' && node.rootId === root.id);
      return <div className="settings-local-folder" key={root.id}>
        <div className="settings-pref-copy"><span className="settings-pref-label">{root.name}</span><span className="settings-pref-value">{root.path}</span></div>
        <div className="team-actions">{mounts.filter((mount) => mount.parentId).map((mount) => <Button variant="secondary" size="sm" key={mount.id} onPress={() => onOpenPrograms?.(mount.parentId ?? undefined)}>{nodes.find((node) => node.id === mount.parentId)?.name ?? 'Open in Programs'}</Button>)}{!mounts.some((mount) => mount.parentId) && <span className="settings-pref-help">Not assigned to a Program. Open Programs to add this folder to your work.</span>}<Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => void disconnect(root)}>Disconnect</Button></div>
      </div>;
    })}
    {error && <p role="alert">{error}</p>}
  </Card>;
}
