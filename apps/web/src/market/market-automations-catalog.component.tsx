import { useEffect, useState } from 'react';
import { Alert, Button, Card, Chip, Modal, SearchField } from '@heroui/react';
import type { AutomationDefinition } from '@office/automations/domain';
import type { ServiceClient } from '../shared/service-client.hook';

type AutomationEntry = { id: string; name: string; description: string; definition?: AutomationDefinition };

function scheduleLabel(definition: AutomationDefinition): string {
  const { frequency, weekdays, localTime, timezone } = definition.recurrence;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const cadence = frequency === 'weekly' ? weekdays.map((day) => days[day]).filter(Boolean).join(', ') || 'Weekly' : frequency === 'daily' ? 'Daily' : 'Once';
  return `${cadence} · ${localTime} · ${timezone}`;
}

export function MarketAutomationsCatalog({ client, onInstalled, onOpenSchedules }: { client: ServiceClient; onInstalled: () => void; onOpenSchedules?: () => void }) {
  const [entries, setEntries] = useState<AutomationEntry[]>([]);
  const [selected, setSelected] = useState<AutomationEntry | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    void client.json<{ entries: AutomationEntry[] }>(`/api/v1/market/catalog?kind=automation&timezone=${encodeURIComponent(timezone)}`)
      .then((result) => { if (active) setEntries(result.entries); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'The catalog could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client]);

  async function install(entry: AutomationEntry) {
    setBusy(true); setError(''); setNotice('');
    try {
      if (!entry.definition) throw new Error('This automation has no installable definition.');
      const now = new Date().toISOString();
      await client.json('/api/v1/calendar/import', { method: 'POST', body: JSON.stringify({ bundle: { schema_version: 1, calendars: [], events: [], automations: [{ ...entry.definition, id: crypto.randomUUID(), enabled: false, createdAt: now, updatedAt: now }] } }) });
      setInstalled((current) => [...current, entry.id]);
      setNotice('Added paused. Review the schedule and choose a model in Schedules before enabling.');
      onInstalled();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'This automation could not be added.'); }
    finally { setBusy(false); }
  }

  const visible = entries.filter((entry) => `${entry.name} ${entry.description}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="market-automations" aria-label="Automations catalog">
    <SearchField aria-label="Search automations" value={query} onChange={setQuery}><SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="Search automations..." /><SearchField.ClearButton /></SearchField.Group></SearchField>
    {loading && <p role="status">Loading automations...</p>}
    {!selected && error && <p role="alert">{error}</p>}
    <div className="market-automations__grid">{visible.map((entry) => <Card key={entry.id} className="market-automations__card">
      <Card.Header><Card.Title>{entry.name}</Card.Title><Card.Description>{entry.description}</Card.Description></Card.Header>
      <Card.Content>{entry.definition && <Chip size="sm" variant="soft">{scheduleLabel(entry.definition)}</Chip>}</Card.Content>
      <Card.Footer><Button variant="secondary" onPress={() => { setSelected(entry); setError(''); setNotice(''); }}>View template</Button>{installed.includes(entry.id) && <Chip size="sm" color="success">Added</Chip>}</Card.Footer>
    </Card>)}</div>
    {!loading && !error && visible.length === 0 && <p>No matching automations in the configured sources.</p>}
    {selected && <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open && !busy) setSelected(null); }}><Modal.Container><Modal.Dialog aria-labelledby="automation-template-title">
      <Modal.CloseTrigger isDisabled={busy} /><Modal.Header><Modal.Heading id="automation-template-title">{selected.name}</Modal.Heading></Modal.Header>
      <Modal.Body className="market-automations__details"><p>{selected.description}</p>
        {selected.definition && <><div><strong>Suggested schedule</strong><p>{scheduleLabel(selected.definition)}</p></div><div><strong>Prompt</strong>{selected.definition.steps.map((step, index) => step.kind === 'prompt' ? <p key={index}>{step.prompt}</p> : null)}</div></>}
        <Alert status="accent"><Alert.Indicator /><Alert.Content><Alert.Description>Added paused. Review the schedule, prompt and model in Schedules before enabling. Templates use the context you provide; they do not automatically read your calendar, files or chats.</Alert.Description></Alert.Content></Alert>
        {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
      </Modal.Body><Modal.Footer><Button variant="secondary" isDisabled={busy} onPress={() => setSelected(null)}>Close</Button>{installed.includes(selected.id) && onOpenSchedules ? <Button onPress={onOpenSchedules}>Open schedules</Button> : <Button isDisabled={busy || installed.includes(selected.id) || !selected.definition} onPress={() => void install(selected)}>{installed.includes(selected.id) ? 'Added' : busy ? 'Adding...' : 'Add template'}</Button>}</Modal.Footer>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>}
  </section>;
}
