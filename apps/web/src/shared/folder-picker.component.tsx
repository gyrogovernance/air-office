import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Input, Modal } from '@heroui/react';
import { desktopInvoke, isDesktopHost } from '../entry/desktop-host.adapter';
import { IconChevronLeft, IconFolder, IconPlus } from '../app/ui-icons.component';
import { createServiceClient, type ServiceClient } from './service-client.hook';

type Listing = { current: string; parent: string | null; roots: { name: string; path: string }[]; folders: { name: string; path: string }[]; truncated: boolean };

function rootSelected(current: string, rootPath: string) {
  const normalized = current.replace(/[/\\]+$/, '').toLowerCase();
  const root = rootPath.replace(/[/\\]+$/, '').toLowerCase();
  return normalized === root || normalized.startsWith(`${root}\\`) || normalized.startsWith(`${root}/`);
}

export function FolderPickerButton({ onSelect, label = 'Choose folder', title = 'Choose folder', disabled = false, iconOnly = false, client = createServiceClient() }: { onSelect: (path: string) => void; label?: string; title?: string; disabled?: boolean; iconOnly?: boolean; client?: ServiceClient }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  async function choose() {
    setError('');
    if (!isDesktopHost()) { setOpen(true); return; }
    try { const path = await desktopInvoke<string | null>('select_data_folder'); if (path) onSelect(path); }
    catch { setError('The folder picker could not be opened.'); }
  }
  return <>
    <Button
      variant="secondary"
      size="sm"
      isIconOnly={iconOnly}
      aria-label={iconOnly ? label : undefined}
      isDisabled={disabled}
      onPress={() => void choose()}
    >{iconOnly ? <IconFolder/> : label}</Button>
    {error && <p role="alert">{error}</p>}
    {open && <FolderPicker client={client} title={title} onClose={() => setOpen(false)} onSelect={(path) => { onSelect(path); setOpen(false); }}/>}
  </>;
}

function FolderPicker({ client, title, onClose, onSelect }: { client: ServiceClient; title: string; onClose: () => void; onSelect: (path: string) => void }) {
  const epoch = useRef(0);
  const [listing, setListing] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [hidden, setHidden] = useState(false);
  const [address, setAddress] = useState('');
  async function browse(path = '', includeHidden = hidden) {
    const request = ++epoch.current; setBusy(true); setError(''); setCreating(false);
    try { const query = new URLSearchParams({ ...(path ? { path } : {}), ...(includeHidden ? { hidden: '1' } : {}) }); const value = await client.json<Listing>(`/api/v1/storage-folders?${query}`); if (request === epoch.current) { setListing(value); setAddress(value.current); } }
    catch { if (request === epoch.current) setError('This folder could not be opened. Choose another location.'); }
    finally { if (request === epoch.current) setBusy(false); }
  }
  useEffect(() => { void browse(); return () => { epoch.current++; }; }, []);
  async function create() {
    if (!listing) return; setBusy(true); setError('');
    try { const result = await client.json<{ path: string }>('/api/v1/storage-folders', { method: 'POST', body: JSON.stringify({ parent: listing.current, name: name.trim() }) }); setName(''); await browse(result.path); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The folder could not be created.'); setBusy(false); }
  }
  return <Modal isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
    <Modal.Backdrop>
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="folder-picker-dialog" aria-label={title}>
          <Modal.Header>
            <Modal.Heading>{title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="folder-picker">
            <form className="folder-picker-address" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void browse(address); }}>
              <label className="app-dialog-field folder-picker-address-field">Folder path
                <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Paste a folder path" aria-label="Folder path"/>
              </label>
              <Button type="submit" variant="secondary" size="sm" isDisabled={busy || !address.trim()}>Open</Button>
            </form>

            {listing && <section className="folder-picker-browser" aria-label="Browse folders">
              <nav className="folder-picker-roots" aria-label="Folder locations">
                {listing.roots.map((root) => (
                  <Button
                    key={root.path}
                    variant="secondary"
                    size="sm"
                    className={`folder-picker-root${rootSelected(listing.current, root.path) ? ' is-current' : ''}`}
                    isDisabled={busy}
                    onPress={() => void browse(root.path)}
                  >{root.name}</Button>
                ))}
              </nav>

              <div className="folder-picker-toolbar">
                <p className="folder-picker-current" title={listing.current}>{listing.current}</p>
                <div className="folder-picker-toolbar-actions">
                  <Button variant="secondary" size="sm" isIconOnly aria-label="Up one folder" isDisabled={busy || !listing.parent} onPress={() => listing.parent && void browse(listing.parent)}><IconChevronLeft/></Button>
                  <Button variant="secondary" size="sm" isDisabled={busy} onPress={() => setCreating(!creating)}><IconPlus/>New folder</Button>
                </div>
              </div>

              {creating && <form className="folder-picker-create" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void create(); }}>
                <label className="app-dialog-field folder-picker-create-field">Folder name
                  <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={120} aria-label="Folder name"/>
                </label>
                <Button type="submit" variant="secondary" size="sm" isDisabled={busy || !name.trim()}>Create</Button>
              </form>}

              <div className="folder-picker-list" aria-label="Folders" aria-busy={busy}>
                {listing.folders.map((folder) => (
                  <button type="button" className="folder-picker-row" key={folder.path} disabled={busy} onClick={() => void browse(folder.path)}>
                    <IconFolder className="folder-picker-row-icon"/>
                    <span className="folder-picker-row-name">{folder.name}</span>
                  </button>
                ))}
                {listing.folders.length === 0 && <p className="folder-picker-empty">No subfolders</p>}
              </div>
            </section>}

            <div className="folder-picker-meta">
              <Checkbox isSelected={hidden} onChange={(checked) => { setHidden(checked); void browse(listing?.current, checked); }}>
                <Checkbox.Content>
                  <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                  Show hidden folders
                </Checkbox.Content>
              </Checkbox>
              {busy && <p className="folder-picker-status" role="status">Opening folder…</p>}
              {listing?.truncated && <p className="folder-picker-status">Only the first 2,000 folders are shown.</p>}
              {error && <p className="folder-picker-error" role="alert">{error}</p>}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onPress={onClose}>Cancel</Button>
            <Button className="folder-picker-select" isDisabled={!listing || busy} onPress={() => listing && onSelect(listing.current)}>Select this folder</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </Modal>;
}
