import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type Metrics = {
  visible: boolean;
  thumbTop: number;
  thumbHeight: number;
  trackHeight: number;
};

const TOP_INSET = 'calc(var(--stage-rim-width, 0px) + var(--space-2) * 2 + 38px)';
const BOTTOM_INSET = 'calc(var(--stage-rim-width, 0px) + var(--space-2) * 2 + 38px)';

function readMetrics(scroller: HTMLElement, track: HTMLElement): Metrics {
  const scrollHeight = scroller.scrollHeight;
  const clientHeight = scroller.clientHeight;
  const trackHeight = track.clientHeight;
  if (scrollHeight <= clientHeight + 1 || trackHeight <= 0) {
    return { visible: false, thumbTop: 0, thumbHeight: 0, trackHeight };
  }
  const thumbHeight = Math.max(28, (clientHeight / scrollHeight) * trackHeight);
  const maxThumbTravel = Math.max(0, trackHeight - thumbHeight);
  const maxScroll = Math.max(1, scrollHeight - clientHeight);
  const thumbTop = (scroller.scrollTop / maxScroll) * maxThumbTravel;
  return { visible: true, thumbTop, thumbHeight, trackHeight };
}

/** Overlay scrollbar: content can scroll full-bleed under chrome; the thumb only travels the inset band. */
export function StageScrollbar({
  scrollerId,
  top = TOP_INSET,
  bottom = BOTTOM_INSET,
  className = 'stage-scrollbar',
}: {
  scrollerId: string;
  top?: string;
  bottom?: string;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startScrollTop: number; maxScroll: number; maxThumbTravel: number } | null>(null);
  const [metrics, setMetrics] = useState<Metrics>({ visible: false, thumbTop: 0, thumbHeight: 0, trackHeight: 0 });

  const sync = useCallback(() => {
    const scroller = document.getElementById(scrollerId);
    const track = trackRef.current;
    if (!scroller || !track) return;
    setMetrics(readMetrics(scroller, track));
  }, [scrollerId]);

  useEffect(() => {
    const scroller = document.getElementById(scrollerId);
    const track = trackRef.current;
    if (!scroller || !track) return;

    const resizeObserver = new ResizeObserver(sync);
    const observeTree = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(scroller);
      resizeObserver.observe(track);
      if (scroller.firstElementChild) resizeObserver.observe(scroller.firstElementChild);
    };

    sync();
    observeTree();
    scroller.addEventListener('scroll', sync, { passive: true });
    const mutationObserver = new MutationObserver(() => {
      observeTree();
      sync();
    });
    mutationObserver.observe(scroller, { childList: true });

    return () => {
      scroller.removeEventListener('scroll', sync);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [scrollerId, sync]);

  const onTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const scroller = document.getElementById(scrollerId);
    const track = trackRef.current;
    if (!scroller || !track || !metrics.visible) return;

    const rect = track.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const maxScroll = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    const maxThumbTravel = Math.max(1, metrics.trackHeight - metrics.thumbHeight);
    const thumbCenter = metrics.thumbTop + metrics.thumbHeight / 2;
    if (Math.abs(y - thumbCenter) > metrics.thumbHeight / 2) {
      const nextTop = Math.min(maxThumbTravel, Math.max(0, y - metrics.thumbHeight / 2));
      scroller.scrollTop = (nextTop / maxThumbTravel) * maxScroll;
    }

    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: scroller.scrollTop,
      maxScroll,
      maxThumbTravel,
    };
    track.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onTrackPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const scroller = document.getElementById(scrollerId);
    if (!drag || !scroller || event.pointerId !== drag.pointerId) return;
    const delta = event.clientY - drag.startY;
    const scrollDelta = (delta / drag.maxThumbTravel) * drag.maxScroll;
    scroller.scrollTop = Math.min(drag.maxScroll, Math.max(0, drag.startScrollTop + scrollDelta));
  };

  const onTrackPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return (
    <div
      ref={trackRef}
      className={`${className}${metrics.visible ? ' is-visible' : ''}`}
      style={{ top, bottom }}
      onPointerDown={onTrackPointerDown}
      onPointerMove={onTrackPointerMove}
      onPointerUp={onTrackPointerUp}
      onPointerCancel={onTrackPointerUp}
      aria-hidden="true"
    >
      <div
        className={`${className}-thumb`}
        style={{ transform: `translateY(${metrics.thumbTop}px)`, height: metrics.thumbHeight }}
      />
    </div>
  );
}
