import { useState } from 'react';
import { Button, Card, Separator } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ComputerIcon } from '@hugeicons/core-free-icons';
import type { ServiceClient } from '../../shared/service-client.hook';
import { localHardwareFacts } from './local-ai-hardware.policy';

export function LocalAiHardware({ systemInfo, client, onRefresh, onChecked }: { systemInfo: unknown; client: ServiceClient; available?: boolean; onRefresh: () => Promise<void>; onChecked?: (report: unknown) => void }) {
  const [report, setReport] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const facts = localHardwareFacts(report ?? systemInfo);

  async function check() {
    setChecking(true); setError('');
    try {
      const { result } = await client.json<{ result: unknown }>('/api/v1/local-ai/operations', { method: 'POST', body: JSON.stringify({ operation: 'system-info' }) });
      const checked = localHardwareFacts(result);
      if (!checked.processor && !checked.memory && checked.devices.length === 0) throw new Error('Empty hardware report');
      setReport(result);
      onChecked?.(result);
      await onRefresh();
    } catch { setError('Compatibility could not be checked. Try again.'); }
    finally { setChecking(false); }
  }

  const reported = [
    facts.processor ? ['Processor', facts.processor] as const : null,
    facts.memory ? ['Memory', facts.memory] as const : null,
    ...facts.devices.map((device) => [device.detail, device.name] as const),
  ].filter((item): item is readonly [string, string] => item !== null);
  return <Card render={(props) => <section {...props} />} className="local-hardware rounded-2xl p-3" aria-label="Hardware compatibility">
    <div className="model-connections-toolbar"><h3 className="settings-block-heading"><HugeiconsIcon icon={ComputerIcon} size={18} aria-hidden="true" />{facts.demo ? 'Demo hardware' : 'Hardware compatibility'}</h3><Button variant="secondary" size="sm" isDisabled={checking} onPress={() => void check()}>{checking ? 'Checking...' : 'Check compatibility'}</Button></div>
    <Separator />
    {reported.length > 0 && <dl className="local-hardware-facts">{reported.map(([label, value]) => <div key={`${label}:${value}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    {error && <p role="alert">{error}</p>}
  </Card>;
}
