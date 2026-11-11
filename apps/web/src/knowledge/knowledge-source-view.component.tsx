import { useEffect, useState } from 'react';
import type { ExtractionArtifact, SourceDocument, SourceVersion } from '@office/contracts/document';
import type { ServiceClient } from '../shared/service-client.hook';
import { PdfStageViewer } from '../workspace/pdf-stage-viewer.component';

type Source = { name: string; bytes: ArrayBuffer; text: string | null; url: string };

export function KnowledgeSourceView({ versionId, client }: { versionId: string; client: ServiceClient }) {
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let url = '';
    setSource(null);
    setError('');
    void (async () => {
      try {
        const [record, listing, response, extraction] = await Promise.all([
          client.json<{ version: SourceVersion }>(`/api/v1/versions/${encodeURIComponent(versionId)}`),
          client.json<{ documents: SourceDocument[] }>('/api/v1/documents'),
          client.request(`/api/v1/versions/${encodeURIComponent(versionId)}/source`),
          client.json<{ artifact: ExtractionArtifact }>(`/api/v1/versions/${encodeURIComponent(versionId)}/artifact`).catch(() => null),
        ]);
        if (!response.ok) throw new Error('This source is unavailable.');
        const name = listing.documents.find((document) => document.id === record.version.documentId)?.name ?? 'Source';
        const bytes = await response.arrayBuffer();
        if (cancelled) return;
        const extension = name.split('.').pop()?.toLowerCase();
        const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
        const mime = /\.pdf$/i.test(name) ? 'application/pdf' : imageTypes[extension ?? ''] ?? 'application/octet-stream';
        url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        const text = extraction?.artifact.text ?? (/\.(txt|md|markdown)$/i.test(name) ? new TextDecoder().decode(bytes) : null);
        setSource({ name, bytes, text, url });
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'This source is unavailable.');
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [client, versionId]);

  if (error) return <section className="external-preview"><p role="alert">{error}</p></section>;
  if (!source) return <section className="external-preview"><p role="status">Opening source…</p></section>;
  if (/\.pdf$/i.test(source.name)) return <PdfStageViewer data={source.bytes} name={source.name} downloadUrl={source.url}/>;
  return <section className="external-preview" aria-label={source.name}>
    <header className="external-preview-header"><h2>{source.name}</h2><a href={source.url} download={source.name}>Download</a></header>
    {/\.(png|jpe?g|gif|webp)$/i.test(source.name) && <img className="external-preview-media" src={source.url} alt={source.name}/>}
    {source.text !== null ? <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{source.text}</pre> : !/\.(png|jpe?g|gif|webp)$/i.test(source.name) ? <p>Download this source to open it.</p> : null}
  </section>;
}
