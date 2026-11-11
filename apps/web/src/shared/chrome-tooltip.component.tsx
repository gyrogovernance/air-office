import { cloneElement, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { hideChromeTip, showChromeTip, tipPoint, type ChromeTipPlacement } from './chrome-floating-tip';

/**
 * Floating tip for chrome controls. Same portal pattern as WorkspaceTabs:
 * glass surfaces use clip-path, so tips must render on document.body.
 * Tip state lives outside this component so hover does not re-render the trigger
 * (re-renders mid-press were canceling clicks on player / rail buttons).
 */
export function ChromeTooltip({
  label,
  children,
  placement = 'top',
  wrapDisabled = false,
}: {
  label: string;
  children: ReactElement;
  placement?: ChromeTipPlacement;
  /** Disabled controls ignore hover; wrap so the tip can still open. */
  wrapDisabled?: boolean;
}) {
  if (!label) return children;

  const show = (event: ReactPointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    showChromeTip({ label, placement, ...tipPoint(box, placement) });
  };
  const hide = () => hideChromeTip();

  if (wrapDisabled) {
    return (
      <span className="chrome-tooltip-host" onPointerEnter={show} onPointerLeave={hide}>
        {children}
      </span>
    );
  }

  const child = children as ReactElement<{
    onPointerEnter?: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerLeave?: (event: ReactPointerEvent<HTMLElement>) => void;
  }>;
  return cloneElement(child, {
    onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => {
      child.props.onPointerEnter?.(event);
      show(event);
    },
    onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => {
      child.props.onPointerLeave?.(event);
      hide();
    },
  });
}
