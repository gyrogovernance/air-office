import { useEffect, useState } from 'react';
import { Button, Card, Separator } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Folder01Icon } from '@hugeicons/core-free-icons';
import { desktopInvoke, isDesktopHost } from '../../entry/desktop-host.adapter';

export interface LocalAiImportFolderProps {
  /** Authenticated AIR service request function supplied by the settings owner. */
  importFolder: (selection: { id: string }) => Promise<unknown>;
  onImported?: () => void | Promise<void>;
  selectFolder?: () => Promise<{ id: string; label: string } | null>;
  desktopAvailable?: boolean;
  connectedFolder?: () => Promise<{ connected: boolean; label?: string }>;
  disconnectFolder?: () => Promise<unknown>;
}
const nativeSelect = () => desktopInvoke<{ id: string; label: string } | null>('select_lemonade_model_folder');

export function LocalAiImportFolder({ importFolder, onImported, selectFolder = nativeSelect, connectedFolder, disconnectFolder, desktopAvailable = typeof window !== 'undefined' && isDesktopHost() }: LocalAiImportFolderProps) {
  const [folder, setFolder] = useState<{ connected: boolean; label?: string }>({ connected: false });
  useEffect(() => { let alive = true; if (connectedFolder) void connectedFolder().then((value) => { if (alive) setFolder(value); }).catch(() => { if (alive) setError('The folder connection could not be refreshed.'); }); return () => { alive = false; }; }, [connectedFolder]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function chooseFolder() {
    setBusy(true); setError(''); setNotice('');
    try {
      const selection = await selectFolder();
      if (!selection) return;
      await importFolder({ id: selection.id });
      setFolder({ connected: true, label: selection.label });
      setNotice(`Using ${selection.label}.`);
      await onImported?.();
    } catch {
      setError('The folder could not be imported.');
    } finally { setBusy(false); }
  }
  return <Card render={(props) => <section {...props} />} variant="secondary" className="rounded-2xl p-3 gap-3" aria-label="External model folder" aria-busy={busy}>
    <h3 className="settings-block-heading"><HugeiconsIcon icon={Folder01Icon} size={18} aria-hidden="true" />External model folder</h3><Separator />
    <h3>External folder</h3>
    <p className="method-hint">Point to a folder of GGUF files. Files stay in place; only one folder is connected at a time.</p>
    {folder.connected && <p role="status">{folder.label ?? 'Connected folder'}</p>}
    <div className="team-actions">{folder.connected && disconnectFolder && <Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => { setBusy(true); setError(''); void disconnectFolder().then(async () => { setFolder({ connected: false }); setNotice('Folder disconnected.'); await onImported?.(); }).catch(() => setError('The folder could not be disconnected.')).finally(() => setBusy(false)); }}>Disconnect</Button>}<Button variant="secondary" size="sm" isDisabled={busy || !desktopAvailable} onPress={() => void chooseFolder()}>{busy ? 'Importing…' : folder.connected ? 'Replace folder' : 'Choose folder'}</Button></div>
    {!desktopAvailable && <p className="method-hint">Available in the desktop app.</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </Card>;
}
