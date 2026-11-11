import type { HTMLAttributes, ReactNode } from 'react';
import { Switch } from '@heroui/react';

/** Keeps a HeroUI Switch usable inside GlassMenuContent without dismissing the menu. */
export function MenuSwitchRow({
  label,
  ariaLabel,
  isSelected,
  isDisabled,
  onChange,
  ...rest
}: {
  label: ReactNode;
  ariaLabel: string;
  isSelected: boolean;
  isDisabled?: boolean;
  onChange: (selected: boolean) => void;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className="menu-switch-row"
      role="presentation"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        // Keep menu focus; otherwise Base UI treats the press as an outside dismiss.
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      {...rest}
    >
      <Switch size="sm" aria-label={ariaLabel} isSelected={isSelected} isDisabled={isDisabled} onChange={onChange}>
        <Switch.Content className="menu-switch-row__content">
          <span>{label}</span>
          <Switch.Control><Switch.Thumb/></Switch.Control>
        </Switch.Content>
      </Switch>
    </div>
  );
}
