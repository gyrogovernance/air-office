import { useState } from 'react';
import { Button, Checkbox, Card, Separator } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { RefreshIcon } from '@hugeicons/core-free-icons';
import type { NativeBootstrap } from '../../entry/desktop-window.types';
import { desktopInvoke, isDesktopHost } from '../../entry/desktop-host.adapter';

export type RuntimeUpdateCommand = 'activate_lemonade_runtime' | 'rollback_lemonade_runtime' | 'restart_desktop_services';
type RuntimeInvoke = (command: RuntimeUpdateCommand, args: { generation: number }) => Promise<NativeBootstrap>;

export function publishRuntimeUpdate(bootstrap: NativeBootstrap): void {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(bootstrap.service_base)) throw new Error('The native service address is invalid.');
  window.__AIR_SERVICE_BASE__ = bootstrap.service_base;
  window.__AIR_LEMONADE_STATUS__ = bootstrap.lemonade;
  window.dispatchEvent(new CustomEvent('air-office-bootstrap', { detail: bootstrap }));
}

async function defaultRuntimeInvoke(command: RuntimeUpdateCommand, args: { generation: number }): Promise<NativeBootstrap> {
  return desktopInvoke<NativeBootstrap>(command, args.generation);
}

/** Native-only maintenance controls. Mount within the Local AI diagnostics view. */
export function LocalAiRuntimeUpdate({ run = defaultRuntimeInvoke }: { run?: RuntimeInvoke }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const desktop = typeof window !== 'undefined' && isDesktopHost();
  async function change(command: RuntimeUpdateCommand) {
    const generation = window.__AIR_LEMONADE_STATUS__?.generation;
    if (!desktop || busy || !confirmed || generation == null) return;
    setBusy(true); setError(''); setMessage('Restarting the local runtime and AIR service…');
    try {
      const bootstrap = await run(command, { generation });
      publishRuntimeUpdate(bootstrap);
      setMessage(`Local runtime ${bootstrap.lemonade.release} is active. Refresh model operations before continuing.`);
      setConfirmed(false);
    } catch (reason) {
      setMessage(''); setError('The local services could not be restarted. Check Local AI status and try again.');
    } finally { setBusy(false); }
  }
  return <Card render={(props) => <section {...props} />} className="rounded-xl p-3 gap-3" variant="default" aria-label="Local runtime updates" aria-busy={busy}>
    <h3 className="settings-block-heading"><HugeiconsIcon icon={RefreshIcon} size={18} aria-hidden="true" />Runtime updates</h3><Separator />
    <p className="method-hint">Activate the runtime included with this application, or return to the recorded previous version. Both actions restart the local runtime and AIR service while preserving model files and saved settings.</p>
    {!desktop ? <p className="method-hint">Runtime maintenance is available in the desktop application.</p> : <>
      <Checkbox isSelected={confirmed} isDisabled={busy} onChange={setConfirmed}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>I have stopped active local model operations and can restart the service.</Checkbox.Content></Checkbox>
      <div className="form-actions"><Button variant="secondary" size="sm" isDisabled={busy || !confirmed} onPress={() => void change('restart_desktop_services')}>Restart Local AI</Button>
        <Button variant="secondary" size="sm" isDisabled={busy || !confirmed} onPress={() => void change('activate_lemonade_runtime')}>Activate bundled runtime</Button>
        <Button variant="secondary" size="sm" isDisabled={busy || !confirmed} onPress={() => void change('rollback_lemonade_runtime')}>Restore previous runtime</Button>
      </div>
    </>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </Card>;
}
