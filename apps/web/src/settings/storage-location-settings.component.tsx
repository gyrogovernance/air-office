import { Card, Button, Input, Separator } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Folder01Icon } from '@hugeicons/core-free-icons';
import { useEffect, useMemo, useState } from 'react';
import { createServiceClient } from '../shared/service-client.hook';
import { FolderPickerButton } from '../shared/folder-picker.component';

type StorageStatus = { current: { private: string; public: string; models: string; cache: string; workspace?: string; files?: string; localAi?: string }; pending: string | null; pendingModels: string | null; canRelocate: boolean };

export function StorageLocationSettings() {
  const client = useMemo(() => createServiceClient(), []);
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [destination, setDestination] = useState('');
  const [modelsDestination, setModelsDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const desktop = typeof window !== 'undefined' && Boolean(window.airDesktop);

  useEffect(() => {
    const controller = new AbortController();
    void client.json<StorageStatus>('/api/v1/storage-location', { signal: controller.signal }).then((value) => {
      setStatus(value);
      setDestination(value.pending ?? '');
      setModelsDestination(value.pendingModels ?? '');
    }).catch(() => {
      if (!controller.signal.aborted) setError('Storage locations could not be loaded.');
    });
    return () => controller.abort();
  }, [client]);

  async function save(body: { destination?: string | null; modelsDestination?: string | null }) {
    setBusy(true);
    setError('');
    try {
      const next = await client.json<Omit<StorageStatus, 'canRelocate'>>('/api/v1/storage-location', { method: 'PUT', body: JSON.stringify(body) });
      setStatus((current) => current ? { ...current, ...next } : null);
      if (body.destination === null) setDestination('');
      if (body.modelsDestination === null) setModelsDestination('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Storage location could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    setBusy(true);
    setError('');
    try {
      const { desktopInvoke } = await import('../entry/desktop-host.adapter');
      await desktopInvoke('restart_desktop_services');
      window.location.reload();
    } catch {
      setError('Storage location could not be changed. Restart AIR Office and try again.');
      setBusy(false);
    }
  }

  const contentChanged = Boolean(status?.pending) && status?.pending !== status?.current.private;
  const modelsChanged = Boolean(status?.pendingModels) && status?.pendingModels !== status?.current.models;

  return <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Storage">
    <Card.Header><Card.Title className="flex items-center gap-2" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={Folder01Icon} size={18} aria-hidden="true" />Storage</Card.Title></Card.Header><Separator />
    <p className="settings-pref-help">Saved content, models and temporary files.</p>
    {status && <div className="settings-pref-row">
      <div className="settings-pref-copy">
        <dl className="settings-path-list" aria-label="Storage areas">
          <div><dt>Content</dt><dd title={status.current.private}>{status.current.private}</dd></div>
          <div><dt>Public</dt><dd title={status.current.public}>{status.current.public}</dd></div>
          <div><dt>Models</dt><dd title={status.current.models}>{status.current.models}</dd></div>
          <div><dt>Cache</dt><dd title={status.current.cache}>{status.current.cache}</dd></div>
        </dl>
      </div>
    </div>}

    {status?.canRelocate && <>
      <div className="settings-data-form">
        <label className="settings-pref-copy">Content and cache
          <Input aria-label="AIR Office data folder" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Choose an empty folder" disabled={busy} />
        </label>
        <p className="settings-pref-help">Your notes, chats and files live here, together with the temporary cache.</p>
        <div className="team-actions">
          <FolderPickerButton label="Browse" client={client} disabled={busy} title="Choose AIR Office data folder" onSelect={setDestination} />
          <Button variant="secondary" size="sm" isDisabled={busy || !destination.trim()} onPress={() => void save({ destination: destination.trim() })}>Apply</Button>
        </div>
      </div>

      <div className="settings-data-form">
        <label className="settings-pref-copy">AI models
          <input aria-label="AI models folder" value={modelsDestination} onChange={(event) => setModelsDestination(event.target.value)} placeholder="Choose a folder for models" disabled={busy} />
        </label>
        <p className="settings-pref-help">Downloaded and imported AI models live here. Model files can be large, so keep them on a drive with room to spare.</p>
        <div className="team-actions">
          <FolderPickerButton label="Browse" client={client} disabled={busy} title="Choose AI models folder" onSelect={setModelsDestination} />
          <Button variant="secondary" size="sm" isDisabled={busy || !modelsDestination.trim()} onPress={() => void save({ modelsDestination: modelsDestination.trim() })}>Apply</Button>
        </div>
      </div>

      {(status.pending || status.pendingModels) && <div className="team-actions">
        <Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => void save({ destination: null, modelsDestination: null })}>Cancel</Button>
      </div>}
    </>}

    {status && !status.canRelocate && <p className="settings-pref-help">The data folder is managed by your installation.</p>}

    {(status?.pending || status?.pendingModels) && <div className="settings-callout" role="status">
      <p className="settings-pref-label">Restart required</p>
      <p className="settings-pref-help">Restart AIR Office to use {status.pending ?? status.pendingModels}. Existing content stays at its current location.</p>
      {desktop && <Button size="sm" isDisabled={busy} onPress={() => void restart()}>Restart and apply</Button>}
    </div>}

    {error && <p role="alert">{error}</p>}
  </Card>;
}
