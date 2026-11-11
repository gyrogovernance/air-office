import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Switch } from '@heroui/react';
import { GlassMenuItem, GlassSurface } from '@glass-sdk/liquid-glass';
import type { ServiceClient } from '../../shared/service-client.hook';
import { MenuSwitchRow } from '../../shared/menu-switch-row.component';

interface LocalAiPower { available: boolean; enabled: boolean; stopping: boolean; error?: string; }

function isTransportFailure(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message.trim() : '';
  return !message || message === 'Failed to fetch' || /failed to fetch|networkerror|load failed|service is unavailable/i.test(message);
}

export function LocalAiPower({ client, presentation = 'pill', onMenuInteract }: {
  client: ServiceClient;
  presentation?: 'pill' | 'menu';
  /** Called before a menu-row toggle so the host can keep the profile menu open. */
  onMenuInteract?: () => void;
}) {
  const [power, setPower] = useState<LocalAiPower | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const apply = useCallback((result: LocalAiPower) => {
    setPower(result);
    setError(result.error ?? '');
  }, []);
  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    const generation = generationRef.current;
    try {
      const result = await client.json<LocalAiPower>('/api/v1/local-ai/power');
      if (busyRef.current || generation !== generationRef.current) return;
      apply(result);
    } catch {
      /* Leave the last known switch state; do not pop a floating alert on focus or poll. */
    }
  }, [apply, client]);
  useEffect(() => {
    void refresh();
    const changed = () => { void refresh(); };
    window.addEventListener('focus', changed);
    return () => { window.removeEventListener('focus', changed); };
  }, [refresh]);
  useEffect(() => {
    if (!power?.stopping) return;
    const timer = setTimeout(() => { void refresh(); }, 1000);
    return () => clearTimeout(timer);
  }, [power, refresh]);
  const change = async (enabled: boolean) => {
    if (busyRef.current) return;
    if (enabled && power?.stopping) {
      setError('Wait for Local AI to finish stopping.');
      return;
    }
    const previous = power;
    const generation = ++generationRef.current;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setPower((current) => ({
      available: current?.available ?? true,
      enabled,
      stopping: !enabled && Boolean(current?.available ?? true),
    }));
    try {
      const result = await client.json<LocalAiPower>('/api/v1/local-ai/power', { method: 'PUT', body: JSON.stringify({ enabled }) });
      if (generation !== generationRef.current) return;
      apply(result);
      window.dispatchEvent(new Event('office-models-changed'));
    } catch (reason) {
      if (generation !== generationRef.current) return;
      try {
        const result = await client.json<LocalAiPower>('/api/v1/local-ai/power');
        if (generation !== generationRef.current) return;
        apply(result);
        if (!result.error && !isTransportFailure(reason) && reason instanceof Error && reason.message.trim()) {
          setError(reason.message.trim());
        }
      } catch {
        if (generation !== generationRef.current) return;
        setPower(previous);
        if (!isTransportFailure(reason) && reason instanceof Error && reason.message.trim()) {
          setError(reason.message.trim());
        }
      }
    } finally {
      if (generation === generationRef.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  if (power && !power.available) return null;
  const switchDisabled = !power || busy || power.stopping;
  const label = power?.stopping ? 'Stopping…' : 'Local AI';
  if (presentation === 'menu') {
    return <>
      <MenuSwitchRow
        label={label}
        ariaLabel="Local AI"
        isSelected={power?.enabled ?? false}
        isDisabled={switchDisabled}
        data-enabled={power?.enabled ?? false}
        onChange={(enabled) => {
          onMenuInteract?.();
          void change(enabled);
        }}
      />
      {error ? <p className="local-ai-power-menu-error" role="alert">{error}</p> : null}
      {power?.error && !power.enabled ? (
        <GlassMenuItem disabled={busy || power.stopping} onClick={() => void change(false)}>Retry unloading</GlassMenuItem>
      ) : null}
    </>;
  }
  return <div className="local-ai-power">
    <GlassSurface className="local-ai-power-pill ui-frost" material="regular" refraction={0} radius="capsule" data-enabled={power?.enabled ?? false} data-stopping={power?.stopping ?? false}>
    <Switch size="sm" aria-label="Local AI" isSelected={power?.enabled ?? false} isDisabled={switchDisabled} onChange={value => void change(value)}>
      <Switch.Content className="local-ai-power-switch" aria-label="Local AI"><span>{label}</span><Switch.Control><Switch.Thumb/></Switch.Control></Switch.Content>
    </Switch>
    </GlassSurface>
    {error && <div className="local-ai-power-error">
    <p role="alert">{error}</p>
    {power?.error && !power.enabled && <Button variant="ghost" size="sm" isDisabled={busy || power.stopping} onPress={() => void change(false)}>Retry unloading</Button>}
    </div>}
  </div>;
}
