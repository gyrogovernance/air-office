import { useEffect, useState } from 'react';
import type { FilesystemTarget } from '@office/files/domain';
import type { ServiceClient } from '../shared/service-client.hook';
import { PdfStageViewer } from './pdf-stage-viewer.component';

function previewKind(name: string): 'image' | 'pdf' | 'audio' | 'video' | 'other' {
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name)) return 'image';
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.(mp3|wav|ogg|m4a)$/i.test(name)) return 'audio';
  if (/\.(mp4|webm|mov)$/i.test(name)) return 'video';
  return 'other';
}

function mimeFor(name: string, fallback: string): string {
  if (/\.pdf$/i.test(name)) return 'application/pdf';
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (/\.gif$/i.test(name)) return 'image/gif';
  if (/\.webp$/i.test(name)) return 'image/webp';
  if (/\.svg$/i.test(name)) return 'image/svg+xml';
  return fallback || 'application/octet-stream';
}

/**
 * Stage surface for connected-folder binaries that are not text editors.
 *
 * PDFs reuse the authenticated download path used by chat attachments and
 * knowledge ingest, then open in the full-stage PDF.js viewer. Other media
 * keep lightweight native elements.
 */
export function ExternalFilePreview({ target, client, name }: { target: FilesystemTarget; client: ServiceClient; name: string }) {
  const [url, setUrl] = useState('');
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState('');
  const kind = previewKind(name);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setUrl('');
    setPdfData(null);
    setError('');
    void (async () => {
      try {
        const response = await client.request(`/api/v1/external/download?${new URLSearchParams({ ...target })}`);
        if (!response.ok) throw new Error('This file is unavailable.');
        const bytes = await response.arrayBuffer();
        if (cancelled) return;
        if (kind === 'pdf') {
          setPdfData(bytes.slice(0));
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
          setUrl(objectUrl);
          setError('');
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeFor(name, '') }));
        setUrl(objectUrl);
        setError('');
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Preview unavailable.');
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [target.rootId, target.path, client, name, kind]);

  if (kind === 'pdf') {
    if (error) return <section className="external-preview" data-kind="pdf" aria-label={`Preview ${name}`}><h2>{name}</h2><p role="alert">{error}</p></section>;
    if (!pdfData) return <section className="external-preview" data-kind="pdf" aria-label={`Preview ${name}`}><p role="status">Loading PDF…</p></section>;
    return <PdfStageViewer data={pdfData} name={name} downloadUrl={url || undefined}/>;
  }

  return <section className="external-preview" data-kind={kind} aria-label={`Preview ${name}`}>
    <header className="external-preview-header">
      <h2>{name}</h2>
      {url ? <div className="external-preview-actions"><a href={url} download={name}>Download {name}</a></div> : null}
    </header>
    {error ? <p role="alert">{error}</p>
      : !url ? <p>Loading preview…</p>
      : kind === 'image' ? <img className="external-preview-media" src={url} alt={name}/>
      : kind === 'audio' ? <audio className="external-preview-media" src={url} controls/>
      : kind === 'video' ? <video className="external-preview-media" src={url} controls/>
      : <p>This file is available to download. AIR Office does not have an editor for this format.</p>}
  </section>;
}
