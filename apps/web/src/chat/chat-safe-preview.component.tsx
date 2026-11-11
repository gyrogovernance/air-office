/**
 * Sandboxed HTML/SVG preview via Safe Content Frame + WebPreview chrome
 * (assistant-ui /safe-content-frame/docs/generative-ui and /elements/web-preview).
 */
import { useEffect, useRef, useState } from 'react';
import { SafeContentFrame, type RenderedFrame } from 'safe-content-frame';
import { WebPreview } from '@/components/assistant-ui/elements/web-preview';

const frame = new SafeContentFrame('air-office');

export type ChatSafePreviewKind = 'html' | 'svg';

export function isSafePreviewLanguage(language: string): language is ChatSafePreviewKind {
  return language === 'html' || language === 'svg' || language === 'svg+xml';
}

function toPreviewKind(language: string): ChatSafePreviewKind {
  return language === 'svg' || language === 'svg+xml' ? 'svg' : 'html';
}

/** Live preview of model-written markup in a cross-origin Safe Content Frame. */
export function ChatSafePreview(props: {
  code: string;
  language: string;
  className?: string;
  heightClassName?: string;
}) {
  const kind = toPreviewKind(props.language);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef<RenderedFrame | undefined>(undefined);
  const [origin, setOrigin] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !props.code.trim()) return;

    const controller = new AbortController();
    let rendered: RenderedFrame | undefined;
    setLoading(true);
    setOrigin('');

    const run = kind === 'svg'
      ? frame.renderRaw(props.code, 'image/svg+xml', container, { signal: controller.signal })
      : frame.renderHtml(props.code, container, { signal: controller.signal });

    void run
      .then(async (result) => {
        if (controller.signal.aborted) {
          result.dispose();
          return;
        }
        rendered = result;
        renderedRef.current = result;
        setOrigin(new URL(result.origin).host);
        try {
          await result.fullyLoadedPromiseWithTimeout(5000);
        } catch {
          /* timeout or shim load; still show the frame */
        }
        if (!controller.signal.aborted) setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
      rendered?.dispose();
      renderedRef.current = undefined;
    };
  }, [props.code, kind, reloadKey]);

  return (
    <WebPreview
      origin={origin || 'preview'}
      loading={loading}
      className={props.className}
      onReload={() => setReloadKey((key) => key + 1)}
      onOpenExternal={() => {
        if (!origin) return;
        window.open(`https://${origin}`, '_blank', 'noopener,noreferrer');
      }}
    >
      <div
        key={reloadKey}
        ref={containerRef}
        className={props.heightClassName ?? 'h-56 w-full'}
      />
    </WebPreview>
  );
}
