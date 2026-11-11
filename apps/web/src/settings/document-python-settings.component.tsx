import { useEffect, useState } from 'react';
import { Button, Card, Input, Separator } from '@heroui/react';
import type { ServiceClient } from '../shared/service-client.hook';

/** Knowledge setting for the interpreter that reads PDFs and other documents. */
export function DocumentPythonSettings({ client }: { client: ServiceClient }) {
  const [path, setPath] = useState('');
  const [workerAvailable, setWorkerAvailable] = useState<boolean | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    void client.json<{ path: string | null; workerAvailable: boolean }>('/api/v1/documents/python').then((body) => {
      if (cancelled) return;
      setPath(body.path ?? '');
      setWorkerAvailable(body.workerAvailable);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [client]);

  async function save() {
    setNotice('');
    try {
      const body = await client.json<{ workerAvailable: boolean }>('/api/v1/documents/python', { method: 'POST', body: JSON.stringify({ path }) });
      setWorkerAvailable(body.workerAvailable);
      setNotice(body.workerAvailable ? 'Document reader is using this Python.' : 'That Python could not start the document reader.');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Could not save the Python path.');
    }
  }

  return (
    <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Document reader">
      <Card.Header><Card.Title render={(props) => <h3 {...props} />}>Document reader</Card.Title></Card.Header>
      <Separator />
      <p className="settings-pref-help">Python used when Knowledge reads PDFs. Notes stay in AIR.</p>
      <Input aria-label="Python interpreter" value={path} onChange={(event) => setPath(event.target.value)} placeholder="Path to python.exe" />
      <Button size="sm" onPress={() => void save()}>Save</Button>
      {workerAvailable === false && <p role="status">The document reader is not running.</p>}
      {notice && <p role="status">{notice}</p>}
    </Card>
  );
}
