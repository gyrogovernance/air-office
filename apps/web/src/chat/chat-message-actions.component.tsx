import { Popover } from '@base-ui/react/popover';
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  useAui,
  useAuiState,
} from '@assistant-ui/react';
import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type Dispatch,
  type FC,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { CheckIcon, CopyIcon, DownloadIcon, MoreHorizontalIcon, PencilIcon, RefreshCwIcon } from 'lucide-react';
import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button';
import { IconClose, IconCopy, IconEdit, IconFile, IconFork, IconRefresh, IconThumbDown, IconThumbUp, IconTrash } from '../app/ui-icons.component';
import type { ServiceClient } from '../shared/service-client.hook';
import type { ChatRuntime } from './chat-runtime.hook';
import { ChatSpeechAction } from './chat-speech-action.component';
import {
  planMessageDelete,
  readRatings,
  writeRating,
  type MessageRating,
  type MessageRatingValue,
} from './message-actions.policy';

export type ChatMessageActionsBag = {
  runtime: ChatRuntime;
  client: ServiceClient;
  localModels: { id: string; labels: string[] }[];
  onInsertIntoNote: (text: string) => void;
  appearance?: 'light' | 'dark';
};

const ChatMessageActionsContext = createContext<ChatMessageActionsBag | null>(null);

type MessageActionShared = {
  active: string | null;
  setActive: Dispatch<SetStateAction<string | null>>;
};

const MessageActionSharedContext = createContext<MessageActionShared>({
  active: null,
  setActive: () => undefined,
});

export function ChatMessageActionsProvider(props: ChatMessageActionsBag & { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  const value = {
    runtime: props.runtime,
    client: props.client,
    localModels: props.localModels,
    onInsertIntoNote: props.onInsertIntoNote,
    appearance: props.appearance,
  };
  return (
    <ChatMessageActionsContext.Provider value={value}>
      <MessageActionSharedContext.Provider value={{ active, setActive }}>
        {props.children}
      </MessageActionSharedContext.Provider>
    </ChatMessageActionsContext.Provider>
  );
}

function useMessageActionsBag(): ChatMessageActionsBag {
  const value = useContext(ChatMessageActionsContext);
  if (!value) throw new Error('Chat message actions require ChatMessageActionsProvider.');
  return value;
}

function MessageActionPopover(props: {
  title: string;
  trigger: ReactElement;
  children: (close: () => void) => ReactNode;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const { active, setActive } = useContext(MessageActionSharedContext);
  const close = () => setActive((current) => (current === id ? null : current));
  return (
    <Popover.Root open={active === id} onOpenChange={(open) => (open ? setActive(id) : close())}>
      <Popover.Trigger ref={triggerRef} render={props.trigger} />
      <Popover.Portal>
        <Popover.Positioner
          className="message-action-positioner"
          anchor={() => triggerRef.current?.closest('.aui-assistant-action-bar-root, .aui-user-action-bar-root, .message-actions') ?? null}
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
        >
          <Popover.Popup ref={popupRef} className="message-action-panel">
            <div className="message-action-panel-header">
              <Popover.Title className="message-action-title">{props.title}</Popover.Title>
              <Popover.Close className="message-icon-action" aria-label={`Close ${props.title}`}>
                <IconClose />
              </Popover.Close>
            </div>
            {props.children(close)}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function useMessageRating(conversationId: string | null, messageId: string) {
  const [value, setValue] = useState<MessageRating | null>(() =>
    conversationId ? readRatings(conversationId)[messageId] ?? null : null,
  );
  const [draft, setDraft] = useState('');
  const persist = (next: MessageRating | null) => {
    if (!conversationId) return;
    writeRating(conversationId, messageId, next);
    setValue(next);
  };
  const choose = (choice: MessageRatingValue) => {
    const next = { value: choice, reason: value?.reason ?? '' };
    persist(next);
    setDraft(next.reason);
  };
  const saveReason = () => {
    if (value) persist({ value: value.value, reason: draft.trim().slice(0, 500) });
  };
  return {
    value,
    draft,
    setDraft,
    choose,
    saveReason,
    remove: () => persist(null),
  };
}

function MessageRatingActions(props: { rating: ReturnType<typeof useMessageRating> }) {
  const { rating } = props;
  return (
    <>
      {(['up', 'down'] satisfies MessageRatingValue[]).map((choice) => (
        <MessageActionPopover
          key={choice}
          title="Feedback"
          trigger={
            <button
              className={`message-icon-action${rating.value?.value === choice ? ' message-icon-action-active' : ''}`}
              type="button"
              title={choice === 'up' ? 'Rate helpful' : 'Rate unhelpful'}
              aria-label={choice === 'up' ? 'Rate helpful' : 'Rate unhelpful'}
              aria-pressed={rating.value?.value === choice}
              onClick={() => rating.choose(choice)}
            >
              {choice === 'up' ? <IconThumbUp /> : <IconThumbDown />}
            </button>
          }
        >
          {(close) => (
            <>
              <label className="message-action-field">
                <span className="sr-only">Reason (optional)</span>
                <textarea
                  aria-label="Reason for your rating"
                  placeholder="Reason (optional)"
                  rows={2}
                  maxLength={500}
                  value={rating.draft}
                  onChange={(event) => rating.setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      rating.saveReason();
                      close();
                    }
                  }}
                />
              </label>
              <div className="message-action-panel-actions">
                <button type="button" className="text-button message-delete-conversation" onClick={() => { rating.remove(); close(); }}>
                  Remove rating
                </button>
                <button type="button" className="text-button message-action-primary" onClick={() => { rating.saveReason(); close(); }}>
                  Save
                </button>
              </div>
            </>
          )}
        </MessageActionPopover>
      ))}
    </>
  );
}

const MORE_ITEM_CLASS =
  'aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none';

const MORE_CONTENT_CLASS =
  'aui-action-bar-more-content bg-popover text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out z-50 min-w-[10rem] overflow-hidden rounded-xl border p-1.5';

function ForkMenuItem() {
  const { runtime } = useMessageActionsBag();
  const messageId = useAuiState((state) => state.message.id);
  return (
    <ActionBarMorePrimitive.Item
      className={MORE_ITEM_CLASS}
      onSelect={() => void runtime.forkFrom(messageId)}
    >
      <IconFork />
      Fork conversation
    </ActionBarMorePrimitive.Item>
  );
}

function DeleteAction() {
  const { runtime } = useMessageActionsBag();
  const messageId = useAuiState((state) => state.message.id);
  const plan = runtime.graph && runtime.conversationId ? planMessageDelete(runtime.graph, messageId) : null;
  if (!plan) return null;
  return (
    <MessageActionPopover
      title={plan.replyCount > 0 ? 'Delete this branch?' : 'Delete this message?'}
      trigger={
        <button className="message-icon-action" type="button" title="Delete message" aria-label="Delete message">
          <IconTrash />
        </button>
      }
    >
      {(close) => (
        <>
          <p className="message-action-description">
            {plan.replyCount > 0
              ? `This removes ${plan.messageIds.length} messages, including replies.`
              : 'This message will be removed from the conversation.'}
          </p>
          <div className="message-action-panel-actions">
            <button type="button" className="text-button" onClick={close}>Cancel</button>
            <button
              type="button"
              className="text-button message-action-danger"
              onClick={() => {
                close();
                void runtime.deleteMessage(messageId);
              }}
            >
              {plan.replyCount > 0 ? 'Delete branch' : 'Delete message'}
            </button>
          </div>
          {plan.branchPoint && runtime.conversationId && (
            <button
              type="button"
              className="text-button message-delete-conversation"
              onClick={() => {
                close();
                void runtime.remove(runtime.conversationId ?? '');
              }}
            >
              Delete entire conversation
            </button>
          )}
        </>
      )}
    </MessageActionPopover>
  );
}

function ContinueAction() {
  const { runtime } = useMessageActionsBag();
  const messageId = useAuiState((state) => state.message.id);
  const incomplete = useAuiState((state) => state.message.status?.type === 'incomplete');
  if (!incomplete) return null;
  return (
    <button
      className="message-icon-action"
      type="button"
      title="Continue this response"
      aria-label="Continue this response"
      onClick={() => void runtime.continueMessage(messageId)}
    >
      <IconRefresh />
    </button>
  );
}

function RefineAction() {
  const { runtime } = useMessageActionsBag();
  const messageId = useAuiState((state) => state.message.id);
  const [instruction, setInstruction] = useState('');
  return (
    <MessageActionPopover
      title="Regenerate response"
      trigger={
        <button
          className="message-icon-action"
          type="button"
          title="Regenerate with an instruction"
          aria-label="Regenerate with an instruction"
        >
          <IconEdit />
        </button>
      }
    >
      {(close) => {
        const submit = () => {
          if (!instruction.trim() || runtime.sending) return;
          close();
          void runtime.regenerateWithRefinement(messageId, instruction);
          setInstruction('');
        };
        return (
          <>
            <label className="message-action-field">
              <span className="sr-only">What should change?</span>
              <textarea
                aria-label="Regeneration instruction"
                placeholder="What should change?"
                rows={2}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
            </label>
            <div className="message-action-panel-actions">
              <button type="button" className="text-button" onClick={close}>Cancel</button>
              <button
                type="button"
                className="text-button message-action-primary"
                disabled={!instruction.trim() || runtime.sending}
                onClick={submit}
              >
                Regenerate
              </button>
            </div>
          </>
        );
      }}
    </MessageActionPopover>
  );
}

function InsertIntoNoteMenuItem() {
  const { runtime, onInsertIntoNote } = useMessageActionsBag();
  const aui = useAui();
  const hasGraph = Boolean(runtime.graph);
  if (!hasGraph) return null;
  return (
    <ActionBarMorePrimitive.Item
      className={MORE_ITEM_CLASS}
      onSelect={() => {
        const text = aui.message.getCopyText().trim();
        if (text) onInsertIntoNote(text);
      }}
    >
      <IconFile />
      Insert into note
    </ActionBarMorePrimitive.Item>
  );
}

function messagePlainText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is { type: 'text'; text: string } => Boolean(part) && typeof part === 'object' && (part as { type?: string }).type === 'text' && typeof (part as { text?: unknown }).text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
}

function SpeechAction() {
  const { client, localModels } = useMessageActionsBag();
  const text = useAuiState((state) => messagePlainText(state.message.content));
  return <ChatSpeechAction client={client} text={text} models={localModels} />;
}

/** Assistant message actions restored from the pre-Elements rail. */
export const AirAssistantActionBar: FC = () => {
  const actions = useContext(ChatMessageActionsContext);
  const messageId = useAuiState((state) => state.message.id);
  const conversationId = actions?.runtime.conversationId ?? null;
  const rating = useMessageRating(conversationId, messageId);
  if (!actions) {
    return (
      <ActionBarPrimitive.Root
        hideWhenRunning
        autohide="not-last"
        className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ms-1 flex gap-1 duration-200"
      >
        <ActionBarPrimitive.Copy asChild>
          <TooltipIconButton tooltip="Copy">
            <AuiIf condition={(s) => s.message.isCopied}><CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" /></AuiIf>
            <AuiIf condition={(s) => !s.message.isCopied}><CopyIcon className="animate-in zoom-in-75 fade-in duration-150" /></AuiIf>
          </TooltipIconButton>
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload asChild>
          <TooltipIconButton tooltip="Refresh"><RefreshCwIcon /></TooltipIconButton>
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    );
  }
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root message-actions text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ms-1 flex flex-wrap gap-0 duration-200"
    >
      <MessageRatingActions rating={rating} />
      <ActionBarPrimitive.Copy asChild>
        <button className="message-icon-action" type="button" title="Copy response" aria-label="Copy response">
          <AuiIf condition={(s) => s.message.isCopied}><CheckIcon className="size-4" /></AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}><IconCopy /></AuiIf>
        </button>
      </ActionBarPrimitive.Copy>
      <SpeechAction />
      {/* Incomplete replies use Continue; finished ones use Reload. Both were
          IconRefresh before, so the bar looked like two identical buttons. */}
      <ContinueAction />
      <AuiIf condition={(state) => state.message.status?.type !== 'incomplete'}>
        <ActionBarPrimitive.Reload asChild>
          <button className="message-icon-action" type="button" title="Regenerate response" aria-label="Regenerate response">
            <IconRefresh />
          </button>
        </ActionBarPrimitive.Reload>
      </AuiIf>
      <RefineAction />
      <DeleteAction />
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <button className="message-icon-action" type="button" title="More" aria-label="More actions">
            <MoreHorizontalIcon className="size-4" />
          </button>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content side="bottom" align="start" sideOffset={6} className={MORE_CONTENT_CLASS}>
          <InsertIntoNoteMenuItem />
          <ForkMenuItem />
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className={MORE_ITEM_CLASS}>
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
      </ActionBarPrimitive.Root>
  );
};

/** User message actions sit under the bubble: copy, edit, delete, with fork in More. */
export const AirUserActionBar: FC = () => {
  const actions = useContext(ChatMessageActionsContext);
  if (!actions) {
    return (
      <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" className="aui-user-action-bar-root flex items-center justify-end gap-0">
        <ActionBarPrimitive.Edit asChild>
          <TooltipIconButton tooltip="Edit" className="aui-user-action-edit">
            <PencilIcon />
          </TooltipIconButton>
        </ActionBarPrimitive.Edit>
      </ActionBarPrimitive.Root>
    );
  }
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root message-actions flex items-center justify-end gap-0"
    >
      <ActionBarPrimitive.Copy asChild>
        <button className="message-icon-action" type="button" title="Copy message" aria-label="Copy message">
          <AuiIf condition={(s) => s.message.isCopied}><CheckIcon className="size-4" /></AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}><IconCopy /></AuiIf>
        </button>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Edit asChild>
        <button className="message-icon-action" type="button" title="Edit message" aria-label="Edit message">
          <IconEdit />
        </button>
      </ActionBarPrimitive.Edit>
      <DeleteAction />
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <button className="message-icon-action" type="button" title="More" aria-label="More actions">
            <MoreHorizontalIcon className="size-4" />
          </button>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content side="bottom" align="end" sideOffset={6} className={MORE_CONTENT_CLASS}>
          <ForkMenuItem />
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};
