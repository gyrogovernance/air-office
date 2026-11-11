/**
 * Runtime message queue from assistant-ui Elements docs (/elements/message-queue).
 * Shows while mid-run sends wait behind the current reply.
 */
import { ComposerPrimitive, QueueItemPrimitive, useAuiState } from '@assistant-ui/react';
import { ArrowUpIcon, XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { field, ghostButton, mono } from '@/components/assistant-ui/elements/surfaces';

export function ChatMessageQueue() {
  const queueLength = useAuiState((s) => s.composer.queue.length);
  const canQueue = useAuiState((s) => s.thread.capabilities.queue);
  if (!canQueue || queueLength === 0) return null;

  return (
    <div data-slot="message-queue" className="flex w-full flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <span className={cn(mono, 'text-muted-foreground')}>{queueLength} queued</span>
        <span className={cn(mono, 'text-muted-foreground')}>sends when this finishes</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        <ComposerPrimitive.Queue>
          {({ queueItem }) => (
            <li
              key={queueItem.id}
              className={cn(field, 'flex items-center gap-2.5 rounded-2xl py-2 pr-2 pl-3')}
            >
              <span className="text-foreground/60 min-w-0 flex-1 truncate text-[13.5px]">
                <QueueItemPrimitive.Text />
              </span>
              <QueueItemPrimitive.Steer className={cn(ghostButton, 'shrink-0 px-2 text-xs')}>
                Run now
              </QueueItemPrimitive.Steer>
              <ArrowUpIcon className="text-foreground/25 size-3 shrink-0" aria-hidden />
              <QueueItemPrimitive.Remove aria-label="Remove from queue" className={cn(ghostButton, 'size-6 shrink-0')}>
                <XIcon className="size-3.5" />
              </QueueItemPrimitive.Remove>
            </li>
          )}
        </ComposerPrimitive.Queue>
      </ul>
    </div>
  );
}
