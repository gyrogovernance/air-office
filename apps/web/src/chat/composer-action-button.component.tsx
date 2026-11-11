import { forwardRef, type ComponentProps, type MouseEvent, type MouseEventHandler } from 'react';
import { Button } from '@heroui/react';

type Props = ComponentProps<typeof Button> & {
  /** Merged by assistant-ui primitives (`ComposerPrimitive.Send` / `Cancel`, queue items). */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
};

/**
 * HeroUI Button for assistant-ui `render={...}` slots.
 *
 * Those primitives attach actions through Radix Slot as `onClick`. HeroUI /
 * React Aria drive presses with `onPress` and do not run a Slot-merged
 * `onClick`, so Stop and Queue would otherwise do nothing. This bridges both
 * and maps `disabled` to `isDisabled`.
 */
export const ComposerActionButton = forwardRef<HTMLButtonElement, Props>(function ComposerActionButton(
  { onClick, onPress, disabled, isDisabled, ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      {...props}
      isDisabled={isDisabled ?? disabled}
      onPress={(event) => {
        onPress?.(event);
        onClick?.(event as unknown as MouseEvent<HTMLButtonElement>);
      }}
    />
  );
});
