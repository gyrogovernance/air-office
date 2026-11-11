import { Button, Card, Separator, TextArea } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Calendar03Icon } from '@hugeicons/core-free-icons';
import { useEffect, useState } from 'react';
import { CollapsibleSection } from '../shared/collapsible-section.component';
import { createServiceClient } from '../shared/service-client.hook';
import { useAppDialogs } from '../shared/app-dialogs.component';

type Preview = { calendars: { id: string; name: string }[]; events: { id: string; title: string }[]; automations: { id: string; name: string; enabled: boolean }[]; skipped: number };

export function CalendarImport() {
  const [client] = useState(createServiceClient);
  const dialogs = useAppDialogs();
  const [template, setTemplate] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<{ preview: Preview; requiresConfirmation: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    void client.json<{ template: unknown }>(`/api/v1/calendar/template?timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`).then((result) => {
      if (active) setTemplate(JSON.stringify(result.template, null, 2));
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Template could not be loaded.');
    });
    return () => { active = false; };
  }, [client]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(template);
      setNotice('Template copied.');
    } catch {
      setError('Copy is unavailable. Open the template and copy it manually.');
    }
  }

  async function inspect() {
    setError('');
    setNotice('');
    setPreview(null);
    setBusy(true);
    try {
      const bundle: unknown = JSON.parse(text);
      setPreview(await client.json('/api/v1/calendar/import', { method: 'POST', body: JSON.stringify({ bundle, preview: true }) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Enter valid calendar JSON.');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview) return;
    let confirmed = false;
    if (preview.requiresConfirmation) {
      confirmed = await dialogs.confirm({
        title: 'Allow scheduled tools?',
        message: 'This import enables automations with tools that can change data. Allow those scheduled runs?',
        confirmLabel: 'Import and allow scheduled tools',
      });
      if (!confirmed) return;
    }
    setBusy(true);
    setError('');
    try {
      const bundle: unknown = JSON.parse(text);
      const { imported } = await client.json<{ imported: { calendars: number; events: number; automations: number; skipped: number } }>('/api/v1/calendar/import', { method: 'POST', body: JSON.stringify({ bundle, confirmed }) });
      setNotice(`Imported ${imported.calendars} calendars, ${imported.events} events and ${imported.automations} automations. ${imported.skipped} existing IDs skipped.`);
      setPreview(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Calendar import failed.');
    } finally {
      setBusy(false);
    }
  }

  return <Card variant="secondary" className="calendar-import rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Calendar import">
    <Card.Header><Card.Title className="settings-block-heading" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={Calendar03Icon} size={18} aria-hidden="true" />Calendar import</Card.Title></Card.Header>
    <Separator />
    <p className="settings-pref-help">Paste calendar JSON to add events and automations. Existing IDs are skipped.</p>
    <div className="team-actions">
      <Button variant="secondary" size="sm" isDisabled={!template} onPress={() => void copy()}>Copy template</Button>
    </div>
    <CollapsibleSection className="settings-inline-details" title="View template">
      <TextArea aria-label="Calendar JSON template" readOnly value={template} spellCheck={false} />
    </CollapsibleSection>
    <label className="app-dialog-field">Paste JSON
      <TextArea aria-label="Import calendar JSON" value={text} maxLength={128000} placeholder="Paste calendar JSON here" spellCheck={false} onChange={(event) => { setText(event.target.value); setPreview(null); setNotice(''); }} />
    </label>
    <div className="form-actions">
      <Button variant="secondary" size="sm" isDisabled={busy || !text.trim()} onPress={() => void inspect()}>Preview</Button>
      <Button size="sm" isDisabled={busy || !preview} onPress={() => void apply()}>{busy ? 'Working…' : 'Import'}</Button>
    </div>
    {preview && <div className="calendar-import-preview" aria-label="Calendar import preview">
      <h4>Will add</h4>
      <ul>
        {preview.preview.calendars.map((item) => <li key={`calendar:${item.id}`}>Calendar: {item.name}</li>)}
        {preview.preview.events.map((item) => <li key={`event:${item.id}`}>Event: {item.title}</li>)}
        {preview.preview.automations.map((item) => <li key={`automation:${item.id}`}>Automation: {item.name} · {item.enabled ? 'enabled' : 'paused'}</li>)}
      </ul>
      <p>{preview.preview.skipped} existing IDs will be skipped.</p>
    </div>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </Card>;
}