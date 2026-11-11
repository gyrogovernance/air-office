import { useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Checkbox, Dropdown, Fieldset, Input, Modal } from '@heroui/react';
import type { FetchedWebPage } from '@office/contracts/capability';
import type { Collection } from '@office/contracts/knowledge';
import type { ServiceClient } from '../shared/service-client.hook';
import { CollapsibleSection } from '../shared/collapsible-section.component';
import { SelectField } from '../shared/select-field.component';
import { IconFolder } from '../app/ui-icons.component';

const PREFERENCE_KEY = 'air-office:web-source-saving';
function preferences() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? '{}');
    if (value && typeof value === 'object') return {
      collectionId: 'collectionId' in value && typeof value.collectionId === 'string' ? value.collectionId : '',
      prefix: 'prefix' in value && typeof value.prefix === 'string' ? value.prefix : '',
      skip: 'skip' in value && value.skip === true
    };
  } catch { /* A missing preference uses the ordinary source picker. */ }
  return { collectionId: '', prefix: '', skip: false };
}

export function WebSourceList({ sources }: { sources: readonly FetchedWebPage[] }) {
  if (!sources.length) return null;
  return <CollapsibleSection className="chat-web-sources" title={`Sources · ${sources.length}`}><ol>{sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>{source.truncated && <small> · Partial page</small>}</li>)}</ol></CollapsibleSection>;
}

export function SaveWebSourcesAction({ client, sources, conversationId, messageId, presentation = 'button' }: { client: ServiceClient; sources: readonly FetchedWebPage[]; conversationId: string; messageId: string; presentation?: 'button' | 'menu-item' }) {
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [preferred, setPreferred] = useState(preferences);
  const [collectionId, setCollectionId] = useState(preferred.collectionId);
  const [prefix, setPrefix] = useState(preferred.prefix);
  const [skip, setSkip] = useState(preferred.skip);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  async function save(urls: string[], destination: string) {
    setBusy(true); setError('');
    try {
      const result = await client.json<{ saved: string[]; skipped: string[] }>('/api/v1/web-sources/save', { method: 'POST', body: JSON.stringify({ conversationId, messageId, collectionId: destination, urls, prefix }) });
      const next = { collectionId: destination, prefix, skip };
      localStorage.setItem(PREFERENCE_KEY, JSON.stringify(next)); setPreferred(next);
      setStatus(`${result.saved.length} saved${result.skipped.length ? ` · ${result.skipped.length} already in Knowledge` : ''}`);
      setOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'These sources could not be saved.'); }
    finally { setBusy(false); }
  }
  async function choose() {
    setBusy(true); setError(''); setStatus('');
    const urls = sources.slice(0, 10).map((source) => source.url);
    try {
      const value = await client.json<{ collections: Collection[] }>('/api/v1/collections');
      setCollections(value.collections); setSelected(urls);
      const destination = value.collections.some((collection) => collection.id === preferred.collectionId) ? preferred.collectionId : value.collections[0]?.id ?? '';
      setCollectionId(destination);
      if (preferred.skip && destination === preferred.collectionId && destination) { await save(urls, destination); return; }
      setOpen(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Knowledge collections could not be loaded.'); }
    finally { setBusy(false); }
  }
  if (!sources.length) return null;
  const trigger: ReactNode = presentation === 'menu-item'
    ? <Dropdown.Item id="save-web-sources" textValue="Save sources" className="chat-view-menu-item" isDisabled={busy} onPress={() => void choose()}><IconFolder/>Save sources</Dropdown.Item>
    : <Button isIconOnly variant="ghost" size="sm" aria-label="Save web sources to Knowledge" isDisabled={busy} onPress={() => void choose()}><IconFolder/></Button>;
  const extras = <>
    {status && <span className="message-source-status" role="status">{status}</span>}
    {!open && error && <span role="alert">{error}</span>}
    <Modal.Backdrop isOpen={open} onOpenChange={setOpen} className="method-dialog-backdrop">
      <Modal.Container placement="center">
        <Modal.Dialog className="method-dialog web-source-dialog" aria-describedby={descriptionId}>
          <Modal.Header>
            <Modal.Heading>Save sources to Knowledge</Modal.Heading>
            <p id={descriptionId}>Choose the pages you want to keep. Pages already in this collection will be skipped.</p>
          </Modal.Header>
          <Modal.Body>
          <Fieldset className="web-source-choices"><Fieldset.Legend>Opened pages</Fieldset.Legend>{sources.slice(0, 10).map((source) => <Checkbox key={source.url} isSelected={selected.includes(source.url)} onChange={(checked) => setSelected((current) => checked ? [...current, source.url] : current.filter((url) => url !== source.url))}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><span>{source.title}<small>{new URL(source.url).hostname}</small></span></Checkbox.Content></Checkbox>)}</Fieldset>
          {sources.length > 10 && <p>You can save up to ten sources at a time.</p>}
          {collections.length ? <SelectField aria-label="Knowledge collection" value={collectionId} onValueChange={setCollectionId}>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</SelectField> : <p>Create a Knowledge collection before saving sources.</p>}
          <CollapsibleSection title="Saving preferences">
            <label className="settings-pref-row">Name prefix<Input value={prefix} maxLength={40} onChange={(event) => setPrefix(event.target.value)}/></label>
            <Checkbox className="settings-pref-row" isSelected={skip} onChange={setSkip}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>Save to this collection without asking next time</Checkbox.Content></Checkbox>
          </CollapsibleSection>
          {error && <p role="alert">{error}</p>}
          </Modal.Body>
          <Modal.Footer className="form-actions"><Button variant="secondary" size="sm" slot="close" onPress={() => setOpen(false)}>Cancel</Button><Button size="sm" isDisabled={busy || !selected.length || !collectionId} onPress={() => void save(selected, collectionId)}>Save selected sources</Button></Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </>;
  if (presentation === 'menu-item') return <>{trigger}{createPortal(extras, document.body)}</>;
  return <>{trigger}{extras}</>;
}
