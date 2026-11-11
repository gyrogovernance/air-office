import { useMemo, useState } from 'react';
import { Button, SearchField } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChevronDownIcon, ChevronRightIcon, Database01Icon, File01Icon } from '@hugeicons/core-free-icons';
import { IconClose } from '../app/ui-icons.component';
import type { KnowledgeWorkspaceState } from '../knowledge/knowledge-workspace.hook';
import { attachContext, contextChipLabel, detachContext, filterContextItems, isContextAttached, orderedContextItems, type ComposerContextSelection } from './composer-context.policy';

/**
 * The knowledge picker of the composer.
 *
 * It shows the collections of the workspace and the documents inside them.
 * Choosing a collection or a document attaches it as context for the next
 * message; the attached items appear as chips above the composer.
 *
 * The panel is a picker, not a management surface. Indexing, extraction and
 * collection editing stay in Settings, where the workspace keeps them.
 *
 * It renders the body only. The dialog around it owns the header, so the
 * picker can be shown in the attach dialog without a second title bar.
 */
export function ComposerKnowledgePicker(props: {
  knowledge: KnowledgeWorkspaceState;
  selection: ComposerContextSelection;
  onChange: (selection: ComposerContextSelection) => void;
}) {
  const { knowledge, selection, onChange } = props;
  const [term, setTerm] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

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

  const filtered = useMemo(() => filterContextItems(
    knowledge.collections.map((collection) => ({ id: collection.id, name: collection.name })),
    knowledge.documents.map((document) => ({ id: document.id, name: document.name, kind: document.kind, collectionId: document.collectionId })),
    term
  ), [knowledge.collections, knowledge.documents, term]);

  // A document outside a collection is still offered, because a person may
  // have ingested one without giving it a home.
  const looseDocuments = filtered.documents.filter((document) => !document.collectionId);

  const toggleCollection = (collectionId: string, name: string) => {
    const item = { kind: 'collection' as const, id: collectionId, name };
    onChange(isContextAttached(selection, item) ? detachContext(selection, item) : attachContext(selection, item));
  };

  const toggleDocument = (documentId: string, name: string, collectionId: string | null) => {
    const item = { kind: 'document' as const, id: documentId, name, collectionId };
    onChange(isContextAttached(selection, item) ? detachContext(selection, item) : attachContext(selection, item));
  };

  return <div className="knowledge-body">
    <div className="knowledge-search">
      <SearchField fullWidth aria-label="Search knowledge" value={term} onChange={setTerm}><SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="Search knowledge" /><SearchField.ClearButton /></SearchField.Group></SearchField>
    </div>
    {filtered.collections.length === 0 && looseDocuments.length === 0 && <p className="knowledge-text">Nothing here yet. Add a collection in Settings, under Knowledge.</p>}
    <div className="knowledge-documents">
      {filtered.collections.map((collection) => {
        const attached = isContextAttached(selection, { kind: 'collection', id: collection.id, name: collection.name });
        const open = expanded === collection.id;
        const documents = documentsByCollection.get(collection.id) ?? [];
        return <div key={collection.id} className="knowledge-group">
          <div className="knowledge-group-row">
            {documents.length > 0
              ? <button type="button" className="knowledge-disclosure" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} the documents in ${collection.name}`} onClick={() => setExpanded(open ? null : collection.id)}>
                <HugeiconsIcon icon={open ? ChevronDownIcon : ChevronRightIcon} size={16} aria-hidden="true" />
              </button>
              : <span className="knowledge-disclosure knowledge-disclosure-empty" aria-hidden="true" />}
            <button type="button" className="knowledge-item" aria-pressed={attached} aria-label={`Attach ${collection.name}`} onClick={() => toggleCollection(collection.id, collection.name)}>
              <HugeiconsIcon icon={Database01Icon} size={16} aria-hidden="true" />
              <span>{collection.name}</span>
              <small>{attached ? 'Attached' : 'Collection'}</small>
            </button>
          </div>
          {open && documents.length > 0 && <div className="knowledge-documents knowledge-documents-nested">
            {documents.map((document) => {
              const documentAttached = isContextAttached(selection, { kind: 'document', id: document.id, name: document.name, collectionId: document.collectionId });
              return <button key={document.id} type="button" className="knowledge-item" aria-pressed={documentAttached} aria-label={`Attach ${document.name}`} onClick={() => toggleDocument(document.id, document.name, document.collectionId)}>
                <HugeiconsIcon icon={File01Icon} size={16} aria-hidden="true" />
                <span>{document.name}</span>
                <small>{documentAttached ? 'Attached' : document.kind}</small>
              </button>;
            })}
          </div>}
        </div>;
      })}
      {looseDocuments.map((document) => {
        const documentAttached = isContextAttached(selection, { kind: 'document', id: document.id, name: document.name, collectionId: document.collectionId });
        return <button key={document.id} type="button" className="knowledge-item" aria-pressed={documentAttached} aria-label={`Attach ${document.name}`} onClick={() => toggleDocument(document.id, document.name, document.collectionId)}>
          <HugeiconsIcon icon={File01Icon} size={16} aria-hidden="true" />
          <span>{document.name}</span>
          <small>{documentAttached ? 'Attached' : document.kind}</small>
        </button>;
      })}
    </div>
  </div>;
}

/**
 * The chips of the attached context. They sit above the message field inside
 * the composer, so what the next message will carry is visible before it is sent.
 */
export function ComposerContextChips(props: {
  selection: ComposerContextSelection;
  onChange: (selection: ComposerContextSelection) => void;
}) {
  const items = orderedContextItems(props.selection);
  if (items.length === 0) return null;
  return <div className="compose-attachments" aria-label="Attached knowledge">
    {items.map((item) => <div className="compose-attachment" key={`${item.kind}-${item.id}`}>
      <span className="compose-attachment-name">{contextChipLabel(item)}</span>
      <Button type="button" className="compose-chip-remove" variant="ghost" size="sm" isIconOnly aria-label={`Remove ${contextChipLabel(item)}`} onPress={() => props.onChange(detachContext(props.selection, item))}><IconClose/></Button>
    </div>)}
  </div>;
}

