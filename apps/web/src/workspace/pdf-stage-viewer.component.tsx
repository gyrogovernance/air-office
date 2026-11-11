import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import { IconChevronLeft, IconChevronRight, IconDownload } from '../app/ui-icons.component';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

type ZoomMode = 'fit-width' | number;

async function renderPage(pdf: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, width: number, zoom: ZoomMode) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const fit = Math.max(0.5, (width - 32) / base.width);
  const scale = zoom === 'fit-width' ? fit : zoom;
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext('2d');
  if (!context) return;
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
}

/**
 * Full-stage PDF viewer for connected-folder files.
 *
 * Uses the same authenticated download bytes as chat attachments and knowledge
 * ingest, then paints pages with PDF.js so the preview does not depend on the
 * host browser PDF plugin.
 */
export function PdfStageViewer(props: { data: ArrayBuffer; name: string; downloadUrl?: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<ZoomMode>('fit-width');
  const [error, setError] = useState('');
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const downloadUrl = (() => {
    if (!props.downloadUrl) return undefined;
    try {
      const url = new URL(props.downloadUrl, window.location.href);
      return url.protocol === 'blob:' && url.origin === window.location.origin ? props.downloadUrl : undefined;
    } catch {
      return undefined;
    }
  })();

  useEffect(() => {
    let cancelled = false;
    const task = getDocument({ data: props.data.slice(0) });
    void (async () => {
      try {
        const documentProxy = await task.promise;
        if (cancelled) return;
        setPdf(documentProxy);
        setPageCount(documentProxy.numPages);
        setPage(1);
        setError('');
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'This PDF could not be opened.');
      }
    })();
    return () => {
      cancelled = true;
      setPdf(null);
      void task.destroy();
    };
  }, [props.data]);

  useEffect(() => {
    if (!pdf || !scrollerRef.current) return;
    let cancelled = false;
    const host = scrollerRef.current;
    const paint = async () => {
      const width = host.clientWidth || 800;
      for (let number = 1; number <= pdf.numPages; number += 1) {
        if (cancelled) return;
        const canvas = pageRefs.current.get(number);
        if (!canvas) continue;
        try { await renderPage(pdf, number, canvas, width, zoom); }
        catch { /* A single page failure should not blank the whole document. */ }
      }
    };
    const frame = requestAnimationFrame(() => { void paint(); });
    const observer = new ResizeObserver(() => { void paint(); });
    observer.observe(host);
    return () => { cancelled = true; cancelAnimationFrame(frame); observer.disconnect(); };
  }, [pdf, zoom]);

  useEffect(() => {
    const canvas = pageRefs.current.get(page);
    canvas?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [page]);

  const zoomLabel = zoom === 'fit-width' ? 'Fit width' : `${Math.round(zoom * 100)}%`;

  return <section className="pdf-stage-viewer" aria-label={`PDF ${props.name}`}>
    <header className="pdf-stage-toolbar" role="toolbar" aria-label="PDF controls">
      <strong className="pdf-stage-title">{props.name}</strong>
      <div className="pdf-stage-toolbar-group">
        <Button isIconOnly size="sm" variant="tertiary" aria-label="Previous page" isDisabled={page <= 1} onPress={() => setPage((current) => Math.max(1, current - 1))}><IconChevronLeft/></Button>
        <span className="pdf-stage-page" aria-live="polite">{pageCount ? `${page} / ${pageCount}` : '…'}</span>
        <Button isIconOnly size="sm" variant="tertiary" aria-label="Next page" isDisabled={page >= pageCount} onPress={() => setPage((current) => Math.min(pageCount, current + 1))}><IconChevronRight/></Button>
      </div>
      <div className="pdf-stage-toolbar-group">
        <Button size="sm" variant="tertiary" aria-label="Zoom out" isDisabled={zoom !== 'fit-width' && zoom <= 0.5} onPress={() => setZoom((current) => current === 'fit-width' ? 0.9 : Math.max(0.5, Number((current - 0.1).toFixed(2))))}>−</Button>
        <Button size="sm" variant="tertiary" aria-label={`Zoom ${zoomLabel}`} onPress={() => setZoom((current) => current === 'fit-width' ? 1 : 'fit-width')}>{zoomLabel}</Button>
        <Button size="sm" variant="tertiary" aria-label="Zoom in" isDisabled={zoom !== 'fit-width' && zoom >= 2.5} onPress={() => setZoom((current) => current === 'fit-width' ? 1.1 : Math.min(2.5, Number((current + 0.1).toFixed(2))))}>+</Button>
      </div>
      {downloadUrl ? <a className="pdf-stage-download" href={downloadUrl} download={props.name} aria-label={`Download ${props.name}`}><IconDownload/> Download</a> : null}
    </header>
    {error ? <p className="pdf-stage-error" role="alert">{error}</p>
      : !pdf ? <p className="pdf-stage-status" role="status">Loading PDF…</p>
      : <div className="pdf-stage-scroller" ref={scrollerRef} id="pdf-stage-scroll" onScroll={() => {
        const host = scrollerRef.current;
        if (!host) return;
        const mid = host.scrollTop + host.clientHeight / 3;
        let nearest = 1;
        let best = Number.POSITIVE_INFINITY;
        for (const [number, canvas] of pageRefs.current) {
          const top = canvas.offsetTop;
          const distance = Math.abs(top - mid);
          if (distance < best) { best = distance; nearest = number; }
        }
        setPage(nearest);
      }}>
        {Array.from({ length: pageCount }, (_, index) => {
          const number = index + 1;
          return <canvas
            key={number}
            className="pdf-stage-page-canvas"
            data-page={number}
            aria-label={`Page ${number}`}
            ref={(node) => {
              if (node) pageRefs.current.set(number, node);
              else pageRefs.current.delete(number);
            }}
          />;
        })}
      </div>}
  </section>;
}
