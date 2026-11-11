import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

export type ChromeTipPlacement = 'top' | 'bottom' | 'left' | 'right';

type TipState = { label: string; x: number; y: number; placement: ChromeTipPlacement } | null;

let tipState: TipState = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function showChromeTip(next: Exclude<TipState, null>) {
  tipState = next;
  emit();
}

export function hideChromeTip() {
  if (!tipState) return;
  tipState = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return tipState;
}

export function tipPoint(box: DOMRect, placement: ChromeTipPlacement): { x: number; y: number } {
  if (placement === 'right') return { x: box.right + 8, y: box.top + box.height / 2 };
  if (placement === 'left') return { x: box.left - 8, y: box.top + box.height / 2 };
  if (placement === 'top') return { x: box.left + box.width / 2, y: box.top - 8 };
  return { x: box.left + box.width / 2, y: box.bottom + 8 };
}

/** One body-level portal so triggers do not re-render when a tip opens. */
export function ChromeFloatingTipHost() {
  const tip = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!tip || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className={`chrome-floating-tip chrome-floating-tip--${tip.placement}`}
      style={{ left: tip.x, top: tip.y }}
      role="tooltip"
    >
      {tip.label}
    </div>,
    document.body,
  );
}
