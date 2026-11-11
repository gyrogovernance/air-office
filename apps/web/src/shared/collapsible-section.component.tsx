import { Button, Disclosure } from '@heroui/react';
import type { ReactNode } from 'react';

/**
 * Compact HeroUI disclosure for dock strips, message notes, and settings
 * nests that used to be bare <details> markup.
 */
export function CollapsibleSection(props: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  defaultExpanded?: boolean;
  isExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  return (
    <Disclosure
      className={['office-disclosure', props.className].filter(Boolean).join(' ')}
      defaultExpanded={props.defaultExpanded}
      isExpanded={props.isExpanded}
      onExpandedChange={props.onExpandedChange}
    >
      <Disclosure.Heading>
        <Button className="office-disclosure-trigger" slot="trigger" size="sm" variant="ghost">
          <span className="office-disclosure-title">{props.title}</span>
          <Disclosure.Indicator />
        </Button>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className={['office-disclosure-body', props.bodyClassName].filter(Boolean).join(' ')}>
          {props.children}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}
