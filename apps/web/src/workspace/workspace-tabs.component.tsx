import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GlassTabsRoot, GlassTabsList, GlassTabsIndicator, GlassTabsTrigger } from '@glass-sdk/liquid-glass';

export function WorkspaceTabs({ value, onValueChange, items, appearance = 'light', iconOnly = false, tipPlacement = 'bottom', className = '', 'aria-label': label }: {
  value: string;
  onValueChange: (value: string) => void;
  items: readonly { value: string; label: ReactNode; title?: string }[];
  appearance?: 'light' | 'dark';
  iconOnly?: boolean;
  /** Where the icon-rail tip opens. Side rails use left/right so the tip clears the mode title. */
  tipPlacement?: 'bottom' | 'left' | 'right';
  className?: string;
  'aria-label': string;
}) {
  const [tip, setTip] = useState<{ label: string; x: number; y: number; placement: 'bottom' | 'left' | 'right' } | null>(null);

  return <>
    <GlassTabsRoot className={`workspace-tabs ${iconOnly ? 'workspace-tabs-icons' : ''} ${className}`} value={value} onValueChange={(next) => { if (typeof next === 'string') onValueChange(next); }}>
      <GlassTabsList aria-label={label} material="regular" appearance={appearance} radius="capsule">
        <GlassTabsIndicator material="regular" appearance={appearance} radius={iconOnly ? 'circle' : 'capsule'}/>
        {items.map((item) => (
          <GlassTabsTrigger
            key={item.value}
            value={item.value}
            aria-label={item.title}
            onPointerEnter={(event) => {
              if (!iconOnly || !item.title) return;
              const box = event.currentTarget.getBoundingClientRect();
              if (tipPlacement === 'right') {
                setTip({ label: item.title, x: box.right + 8, y: box.top + box.height / 2, placement: 'right' });
                return;
              }
              if (tipPlacement === 'left') {
                setTip({ label: item.title, x: box.left - 8, y: box.top + box.height / 2, placement: 'left' });
                return;
              }
              setTip({ label: item.title, x: box.left + box.width / 2, y: box.bottom + 8, placement: 'bottom' });
            }}
            onPointerLeave={() => setTip(null)}
          >
            {item.label}
          </GlassTabsTrigger>
        ))}
      </GlassTabsList>
    </GlassTabsRoot>
    {tip && createPortal(
      <div
        className={`chrome-floating-tip chrome-floating-tip--${tip.placement}`}
        style={{ left: tip.x, top: tip.y }}
        role="tooltip"
      >
        {tip.label}
      </div>,
      document.body,
    )}
  </>;
}
