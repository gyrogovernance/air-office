import { useMemo, useState } from 'react';
import { Card, Button, Separator } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, Delete02Icon, Edit02Icon, Folder01Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import type { KnowledgeWorkspaceState } from '../knowledge/knowledge-workspace.hook';
import { useAppDialogs } from '../shared/app-dialogs.component';

/**
 * Collections in the Knowledge settings section. A collection is a named set of
 * source documents with its own embedding index. It can be created, renamed,
 * given a description and deleted here, so a collection does not require the
 * Market to exist.
 */
export function KnowledgeCollectionsSettings({ knowledge }: { knowledge: KnowledgeWorkspaceState }) {
  const dialogs = useAppDialogs();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const documentsByCollection = useMemo(() => {
    const grouped = new Map<string, typeof knowledge.documents>();
    for (const document of knowledge.documents) {
      if (!document.collectionId) continue;
      const list = grouped.get(document.collectionId) ?? [];
      list.push(document);
      grouped.set(document.collectionId, list);
    }
    return grouped;
  }, [knowledge.documents]);

  const ready = Boolean(knowledge.embeddingModel && knowledge.embeddingRevision && (knowledge.embeddingDimensions ?? 0) > 0);

  async function create() {
    const name = await dialogs.prompt({ title: 'Create a knowledge base', label: 'Name', submitLabel: 'Create' });
    if (!name?.trim()) return;
    const description = await dialogs.prompt({ title: 'Describe the knowledge base', label: 'What does it hold? (optional)', submitLabel: 'Save' });
    setBusy(true);
    try { await knowledge.createCollection(name.trim(), description?.trim() ?? ''); } finally { setBusy(false); }
  }

  async function rename(collectionId: string, currentName: string, currentDescription: string) {
    const name = await dialogs.prompt({ title: 'Rename knowledge base', label: 'Name', initialValue: currentName, submitLabel: 'Save' });
    if (!name?.trim()) return;
    const description = await dialogs.prompt({ title: 'Describe the knowledge base', label: 'What does it hold?', initialValue: currentDescription, submitLabel: 'Save', multiline: true });
    setBusy(true);
    try { await knowledge.updateCollection(collectionId, name.trim(), description?.trim() ?? ''); } finally { setBusy(false); }
  }

  async function remove(collectionId: string, name: string) {
    const confirmed = await dialogs.confirm({ title: `Delete ${name}?`, message: 'The documents in this knowledge base and their index entries are removed. The original files on disk are not touched.', confirmLabel: 'Delete', destructive: true });
    if (!confirmed) return;
    setBusy(true);
    try { await knowledge.deleteCollection(collectionId); } finally { setBusy(false); }
  }

  async function addText(collectionId: string) {
    const name = await dialogs.prompt({ title: 'Add text content', label: 'Document name', submitLabel: 'Add' });
    if (!name?.trim()) return;
    const body = await dialogs.prompt({ title: `Content of ${name.trim()}`, label: 'Text', submitLabel: 'Add', multiline: true });
    if (!body?.trim()) return;
    setBusy(true);
    try { await knowledge.ingest(name.trim(), body, collectionId); } finally { setBusy(false); }
  }

  return <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Collections">
    <Card.Header><Card.Title className="flex items-center gap-2" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={Folder01Icon} size={18} aria-hidden="true" />Collections</Card.Title></Card.Header><Separator />
    <div className="settings-pref-row">
      <div className="settings-pref-copy">
        <span className="settings-pref-help">A collection groups source documents and keeps its own search index. Everything stays on this computer.</span>
      </div>
      <Button variant="secondary" size="sm" isDisabled={busy} onPress={() => void create()}><HugeiconsIcon icon={Add01Icon} size={16} aria-hidden="true" />New collection</Button>
    </div>
    {knowledge.collections.length === 0 && <p className="settings-pref-help">No collections yet.</p>}
    {knowledge.collections.map((collection) => {
      const status = knowledge.indexStatuses[collection.id];
      const label = !ready
        ? 'Choose a search model under Indexing'
        : status?.rebuildRequired
          ? 'Needs rebuild'
          : status?.current
            ? 'Indexed'
            : 'Not indexed yet';
      const documents = documentsByCollection.get(collection.id) ?? [];
      const open = expanded === collection.id;
      return <Card variant="tertiary" className="rounded-xl p-3 gap-2" key={collection.id}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="settings-pref-copy min-w-0 flex-1">
            <span className="settings-pref-label">{collection.name}</span>
            {collection.description && <span className="settings-pref-help">{collection.description}</span>}
            <span className="settings-pref-help">{label} · {documents.length} document{documents.length === 1 ? '' : 's'}</span>
            {/* The identity and the chunk count say more than "indexed": a
                collection can carry an index and still hold nothing to search. */}
            {status?.current && <span className="settings-pref-help">{status.current.model} · {status.current.dimensions} dimensions · {status.chunks ?? 0} chunks</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
          <Button variant="tertiary" size="sm" aria-expanded={open} onPress={() => setExpanded(open ? null : collection.id)}>{open ? 'Hide documents' : 'Show documents'}</Button>
          <Button variant="secondary" size="sm" isDisabled={!ready || busy} onPress={() => void knowledge.rebuildCollection(collection.id)}><HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />Rebuild</Button>
          <Button variant="tertiary" size="sm" isDisabled={busy} aria-label={`Rename ${collection.name}`} onPress={() => void rename(collection.id, collection.name, collection.description ?? '')}><HugeiconsIcon icon={Edit02Icon} size={16} aria-hidden="true" /></Button>
          <Button variant="tertiary" size="sm" isDisabled={busy} aria-label={`Delete ${collection.name}`} onPress={() => void remove(collection.id, collection.name)}><HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" /></Button>
          </div>
        </div>
        {open && <div className="flex flex-col gap-2">
          <Separator />
          {documents.length === 0 && <p className="settings-pref-help">No documents in this collection yet.</p>}
          {documents.map((document) => <div className="settings-pref-row" key={document.id}><span className="settings-pref-label">{document.name}</span><span className="settings-pref-help">{document.kind}</span></div>)}
          <Button variant="secondary" size="sm" isDisabled={busy} onPress={() => void addText(collection.id)}>Add text content</Button>
        </div>}
      </Card>;
    })}
  </Card>;
}
