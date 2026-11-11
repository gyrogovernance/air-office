"use client";

import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/elements/attachment.aui";
import { File, getFileHref } from "@/components/assistant-ui/elements/file";
import { ThreadFollowupSuggestions } from "@/components/assistant-ui/elements/follow-up-suggestions.aui";
import { Image } from "@/components/assistant-ui/elements/image";
import { MarkdownText } from "@/components/assistant-ui/elements/markdown-text";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/assistant-ui/elements/reasoning.aui";
import { ToolFallback } from "@/components/assistant-ui/elements/tool-fallback.aui";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/elements/tool-group.aui";
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  AirAssistantActionBar,
  AirUserActionBar,
} from "@/chat/chat-message-actions.component";
import {
  ThreadVirtualMessages,
  threadRowGroupBy,
  type ThreadRowRender,
  type VirtualThreadScrollerApi,
} from "@/components/assistant-ui/elements/thread-virtual-messages.aui";
import {
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  type FileMessagePartComponent,
  type ImageMessagePartComponent,
  type TextMessagePartComponent,
  type ToolCallMessagePartComponent,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  AudioLinesIcon,
  CheckIcon,
  CopyIcon,
  MicIcon,
  PhoneIcon,
  SquareIcon,
  PlayIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type FC,
  type PropsWithChildren,
  type ReactNode,
} from "react";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

const DefaultToolGroup: FC<PropsWithChildren<{ group: ThreadGroupPart }>> = ({
  group,
  children,
}) => {
  /** Keep custom tool UIs visible; collapse only when the user closes the group. */
  const [open, setOpen] = useState(true);

  return (
    <ToolGroupRoot
      variant="ghost"
      open={open || group.counts.requiresAction > 0}
      onOpenChange={setOpen}
    >
      <ToolGroupTrigger
        count={group.indices.length}
        active={group.status.type === "running"}
      />
      <ToolGroupContent className="mt-3 flex w-full flex-col gap-4">
        {children}
      </ToolGroupContent>
    </ToolGroupRoot>
  );
};

const shouldShowComposerResume = (s: AssistantState) =>
  !!s.thread.canResume && s.composer.type === "thread" && s.composer.isEmpty;

const reasoningDuration = (timing: ThreadGroupPart["timing"]) =>
  timing?.completedAt === undefined
    ? undefined
    : Math.round((timing.completedAt - timing.startedAt) / 1000);

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups. Tool UIs registered
 * by name (toolkit `render`, `useAssistantDataUI`) take precedence over
 * `ToolFallback`. When `TaskGroup` is set, tool calls that carry a nested
 * conversation and have no registered UI render through it instead of the
 * tool group; without it they render like any other tool call.
 * `ComposerExtra` owns the composer toolbar under the input. It receives
 * send/stop/dictate as `trailing` (placed after Stage beside Send).
 * `AboveComposer` sits in the sticky footer above the composer shell
 * (Ask banner, selection actions, retrieval summaries).
 */
export type ComposerExtraProps = {
  trailing?: ReactNode;
};

export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined;
  Welcome?: ComponentType | undefined;
  ToolFallback?: ToolCallMessagePartComponent | undefined;
  ToolGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
  ReasoningGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
  TaskGroup?: ComponentType<{ group: ThreadGroupPart }> | undefined;
  ComposerExtra?: ComponentType<ComposerExtraProps> | undefined;
  AboveComposer?: ComponentType | undefined;
};

export type ThreadProps = {
  components?: ThreadComponents | undefined;
  autoFocus?: boolean | undefined;
};

const EMPTY_COMPONENTS: ThreadComponents = {};

const ThreadComponentsContext =
  createContext<ThreadComponents>(EMPTY_COMPONENTS);

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

// A switched thread that is still fetching its history: skeleton, not welcome.
const isHistoryLoadingView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  s.thread.isLoading &&
  !s.thread.isDisabled &&
  !s.threads.isLoading;

const ThreadHistorySkeleton: FC = () => (
  <div
    data-slot="aui_thread-history-skeleton"
    role="status"
    className="animate-in fade-in fill-mode-both flex flex-col gap-y-4 [animation-delay:150ms] [animation-duration:200ms]"
  >
    <span className="sr-only">Loading conversation</span>
    <Skeleton className="ml-auto h-9 w-2/5 rounded-xl motion-reduce:animate-none" />
    <div className="flex flex-col gap-y-2">
      <Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-3/5 motion-reduce:animate-none" />
    </div>
    <Skeleton className="ml-auto h-9 w-1/3 rounded-xl motion-reduce:animate-none" />
    <div className="flex flex-col gap-y-2">
      <Skeleton className="h-4 w-10/12 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
    </div>
  </div>
);

export const Thread: FC<ThreadProps> = ({
  components = EMPTY_COMPONENTS,
  autoFocus = true,
}) => {
  const isEmpty = useAuiState(isNewChatView);

  return (
    <ThreadComponentsContext.Provider value={components}>
      <ThreadRoot isEmpty={isEmpty} autoFocus={autoFocus} />
    </ThreadComponentsContext.Provider>
  );
};

const ThreadRoot: FC<{ isEmpty: boolean; autoFocus: boolean }> = ({
  isEmpty,
  autoFocus,
}) => {
  const { Welcome = ThreadWelcome } = useContext(ThreadComponentsContext);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollApiRef = useRef<VirtualThreadScrollerApi | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const renderRow = useCallback<ThreadRowRender>((info) => {
    switch (info.type) {
      case "message":
        if (info.message.composer.isEditing) return <EditComposer />;
        if (info.message.metadata.modality === "voice") return <SpokenMessage />;
        if (info.message.role === "user") return <UserMessage />;
        if (info.message.role === "system") return <SystemMessage />;
        return <AssistantMessageShell />;
      case "part":
        return <AssistantPartRow info={info} />;
      case "turn-end":
        return <AssistantTurnEnd />;
      default:
        return null;
    }
  }, []);

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col"
      style={{
        ["--thread-max-width" as string]: "44rem",
        /* Transparent: the shell uses ui-frost for the glass fill. */
        ["--composer-bg" as string]: "transparent",
        /* Match .stage outer clip (26px); inset drives nested inner radii. */
        ["--composer-radius" as string]: "26px",
        ["--composer-padding" as string]: "10px",
        /* Rail is ~320px: keep bubble padding near the old --space-3 chat shell. */
        ["--message-bubble-inset" as string]: "12px",
        /* Nested plates use a 12px rim from the outer radius (padding can be larger for text). */
        ["--message-inner-radius" as string]:
          "max(10px, calc(var(--composer-radius) - 12px))",
        /* Cards inside a tool plate nest one step further. */
        ["--message-card-radius" as string]:
          "max(8px, calc(var(--message-inner-radius) - 6px))",
      }}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollerRef}
          id="rail-right-chat-scroll"
          data-slot="aui_thread-viewport"
          className="relative flex flex-1 flex-col overflow-x-auto overflow-y-auto"
        >
          <div
            className={cn(
              "mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-3 pt-3",
              isEmpty && "justify-center",
            )}
          >
            <AuiIf condition={isNewChatView}>
              <Welcome />
            </AuiIf>
            <AuiIf condition={isHistoryLoadingView}>
              <ThreadHistorySkeleton />
            </AuiIf>

            <ThreadLoadEarlier />

            <AuiIf condition={(s) => s.thread.messages.length > 0}>
              <ThreadVirtualMessages
                scrollerRef={scrollerRef}
                apiRef={scrollApiRef}
                onAtBottomChange={setAtBottom}
                renderRow={renderRow}
              />
            </AuiIf>
          </div>
        </div>

        {!atBottom && (
          <button
            type="button"
            data-slot="aui_thread-scroll-to-bottom"
            className="border-foreground/10 bg-background/90 text-foreground absolute bottom-[calc(var(--composer-radius)+4.5rem)] left-1/2 z-10 -translate-x-1/2 rounded-full border px-3 py-1.5 text-xs shadow-sm backdrop-blur"
            onClick={() => scrollApiRef.current?.jumpToBottom()}
          >
            <span className="inline-flex items-center gap-1">
              <ArrowDownIcon className="size-3.5" />
              Scroll to bottom
            </span>
          </button>
        )}

        <div
          data-slot="aui_thread-viewport-footer"
          className={cn(
            "aui-thread-viewport-footer mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-3 overflow-visible px-3 pb-3 md:pb-4",
            !isEmpty && "rounded-t-(--composer-radius)",
          )}
        >
          <ThreadFollowupSuggestions />
          <ThreadAboveComposer />
          <Composer autoFocus={autoFocus} />
          <AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
            <ThreadSuggestions />
          </AuiIf>
        </div>
      </div>
    </ThreadPrimitive.Root>
  );
};

const SystemMessage: FC = () => (
  <MessagePrimitive.Root
    data-slot="aui_system-message-root"
    data-role="system"
    className="text-muted-foreground px-2 text-center text-xs"
  >
    <MessagePrimitive.Parts />
  </MessagePrimitive.Root>
);

/** Assistant turns are split across part rows; this shell only covers edit/voice fallbacks. */
const AssistantMessageShell: FC = () => {
  const isEditing = useAuiState((s) => s.message.composer.isEditing);
  if (isEditing) return <EditComposer />;
  return null;
};

type VoiceRunPosition = "single" | "start" | "middle" | "end";

const useVoiceRunPosition = (): VoiceRunPosition =>
  useAuiState((s) => {
    const before =
      s.thread.messages[s.message.index - 1]?.metadata.modality === "voice";
    const after =
      s.thread.messages[s.message.index + 1]?.metadata.modality === "voice";
    if (before) return after ? "middle" : "end";
    return after ? "start" : "single";
  });

const SpokenText: TextMessagePartComponent = ({ text }) => (
  <p className="aui-spoken-message-text m-0">{text}</p>
);

const SpokenMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const position = useVoiceRunPosition();
  const isSpeaking = useAuiState(
    (s) =>
      s.message.role === "assistant" && s.message.status?.type === "running",
  );
  const opensExchange = position === "start" || position === "single";

  return (
    <MessagePrimitive.Root
      data-slot="aui_spoken-message-root"
      data-role={role}
      data-voice-run={position}
      className={cn(
        "aui-spoken-message bg-muted/40 mx-2 px-3 py-1.5 [contain-intrinsic-size:auto_48px] [content-visibility:auto]",
        position === "single" && "rounded-xl py-2",
        position === "start" && "rounded-t-xl pt-2",
        position === "middle" && "-mt-6",
        position === "end" && "-mt-6 rounded-b-xl pb-2",
      )}
    >
      {opensExchange && (
        <div
          data-slot="aui_spoken-exchange-header"
          className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs"
        >
          <PhoneIcon className="size-3" aria-hidden />
          <span>Voice conversation</span>
        </div>
      )}
      <div
        data-slot="aui_spoken-message-content"
        className="text-foreground flex items-start gap-2 text-sm leading-relaxed"
      >
        <span className="text-muted-foreground mt-1 shrink-0" aria-hidden>
          {role === "user" ? (
            <MicIcon className="size-3.5" />
          ) : (
            <AudioLinesIcon className="size-3.5" />
          )}
        </span>
        <span className="sr-only">
          {role === "user" ? "You said" : "Assistant said"}
        </span>
        <div className="min-w-0 flex-1 wrap-break-word">
          <MessagePrimitive.Parts components={{ Text: SpokenText }} />
          {isSpeaking && (
            <span
              data-slot="aui_spoken-message-indicator"
              role="status"
              className="text-muted-foreground ms-1 animate-pulse font-sans"
              aria-label="Assistant is speaking"
            >
              ●
            </span>
          )}
        </div>
        <SpokenActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const SpokenActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="always"
      className="aui-spoken-action-bar text-muted-foreground flex shrink-0 gap-1"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy" className="size-6">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  );
};

const FOCUSABLE_SELECTOR =
  "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1']):not([disabled])";

const nextFocusable = (start: Element) => {
  for (
    let element = start.nextElementSibling;
    element;
    element = element.nextElementSibling
  ) {
    const target = element.matches(FOCUSABLE_SELECTOR)
      ? element
      : element.querySelector(FOCUSABLE_SELECTOR);
    if (target instanceof HTMLElement) return target;
  }
  return null;
};

const ThreadLoadEarlier: FC = () => {
  const visible = useAuiState(
    (s) => s.thread.hasEarlier || s.thread.isLoadingEarlier,
  );
  const loading = useAuiState((s) => s.thread.isLoadingEarlier);
  const slotRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef<Element | null>(null);

  // The last page removes the button; a keyboard user on it continues from the
  // next control in tab order rather than from the document body.
  useLayoutEffect(() => {
    const focused = focusedRef.current;
    const slot = slotRef.current;
    if (visible || !focused || focused.isConnected || !slot) return;
    focusedRef.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    nextFocusable(slot)?.focus();
  }, [visible]);

  return (
    <div
      ref={slotRef}
      className="contents"
      onFocus={(event) => {
        focusedRef.current = event.target;
      }}
    >
      <span role="status" className="sr-only">
        {loading ? "Loading earlier messages" : ""}
      </span>
      {visible && (
        <ThreadPrimitive.LoadEarlier asChild>
          <Button
            variant="ghost"
            size="sm"
            data-slot="aui_thread-load-earlier"
            className="aui-thread-load-earlier text-muted-foreground mb-6 self-center rounded-full"
          >
            <span
              className={cn(loading && "shimmer motion-reduce:animate-none")}
            >
              {loading ? "Loading earlier messages" : "Load earlier messages"}
            </span>
          </Button>
        </ThreadPrimitive.LoadEarlier>
      )}
    </div>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col px-2">
      <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-medium tracking-tight duration-200">
        How can I help you today?
      </p>
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions flex w-full flex-col">
      <ThreadPrimitive.Suggestions>
        {() => <ThreadSuggestionItem />}
      </ThreadPrimitive.Suggestions>
    </div>
  );
};

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200">
      <SuggestionPrimitive.Trigger send asChild>
        <button
          type="button"
          className="aui-thread-welcome-suggestion group hover:bg-foreground/[0.03] focus-visible:ring-ring/50 flex w-full items-baseline gap-2.5 rounded-md px-2 py-2 text-start text-sm transition-colors outline-none focus-visible:ring-1 motion-reduce:transition-none"
        >
          <span
            aria-hidden
            className="text-muted-foreground/60 group-hover:text-foreground font-mono text-xs transition-colors motion-reduce:transition-none"
          >
            {">"}
          </span>
          <span className="min-w-0 flex-1 truncate">
            <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1 text-foreground" />{" "}
            <SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 text-muted-foreground empty:hidden" />
          </span>
        </button>
      </SuggestionPrimitive.Trigger>
    </div>
  );
};

const ThreadAboveComposer: FC = () => {
  const { AboveComposer } = useContext(ThreadComponentsContext);
  if (!AboveComposer) return null;
  return (
    <div data-slot="aui_thread-above-composer" className="flex flex-col gap-2">
      <AboveComposer />
    </div>
  );
};

const Composer: FC<{ autoFocus: boolean }> = ({ autoFocus }) => {
  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone asChild>
        <div
          data-slot="aui_composer-shell"
          className="ui-frost border-foreground/10 focus-within:border-foreground/25 data-[dragging=true]:border-ring flex w-full cursor-text flex-col gap-2 rounded-(--composer-radius) border p-(--composer-padding) shadow-[var(--shadow-pop,0_8px_24px_color-mix(in_srgb,var(--text-strong)_18%,transparent))] transition-[border-color] data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,transparent)]"
        >
          <ComposerAttachments />
          <ComposerPrimitive.Input
            placeholder="Send a message..."
            className="aui-composer-input caret-primary placeholder:text-muted-foreground/60 max-h-48 min-h-8 w-full resize-none bg-transparent px-2 py-0.5 text-sm leading-5 outline-none"
            rows={1}
            autoFocus={autoFocus}
            enterKeyHint="send"
            aria-label="Message input"
          />
          <ComposerAction />
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  const { ComposerExtra } = useContext(ThreadComponentsContext);
  // The stop control only cancels the send while no run it could stop is going.
  const isSending = useAuiState(
    (s) =>
      s.composer.submission !== undefined &&
      !(s.thread.isRunning && s.thread.capabilities.cancel),
  );

  const trailing = (
    <>
      <AuiIf condition={(s) => s.thread.capabilities.dictation}>
        <AuiIf condition={(s) => s.composer.dictation == null}>
          <ComposerPrimitive.Dictate asChild>
            <TooltipIconButton
              tooltip="Voice input"
              side="bottom"
              type="button"
              variant="ghost"
              size="icon"
              className="aui-composer-dictate text-muted-foreground hover:text-foreground size-7 rounded-full"
              aria-label="Start voice input"
            >
              <MicIcon className="aui-composer-dictate-icon size-4" />
            </TooltipIconButton>
          </ComposerPrimitive.Dictate>
        </AuiIf>
        <AuiIf condition={(s) => s.composer.dictation != null}>
          <ComposerPrimitive.StopDictation asChild>
            <TooltipIconButton
              tooltip="Stop dictation"
              side="bottom"
              type="button"
              variant="ghost"
              size="icon"
              className="aui-composer-stop-dictation text-destructive size-7 rounded-full"
              aria-label="Stop voice input"
            >
              <SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
            </TooltipIconButton>
          </ComposerPrimitive.StopDictation>
        </AuiIf>
      </AuiIf>
      <AuiIf
        condition={(s) =>
          (!s.composer.canCancel ||
            (s.thread.voice !== undefined &&
              s.composer.submission === undefined)) &&
          !shouldShowComposerResume(s)
        }
      >
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send message"
            side="bottom"
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-send size-7 rounded-full"
            aria-label="Send message"
          >
            <ArrowUpIcon className="aui-composer-send-icon size-4" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={shouldShowComposerResume}>
        <ComposerPrimitive.Resume asChild>
          <TooltipIconButton
            tooltip="Resume generating"
            side="bottom"
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-resume size-7 rounded-full"
            aria-label="Resume generating"
          >
            <PlayIcon className="aui-composer-resume-icon size-4" />
          </TooltipIconButton>
        </ComposerPrimitive.Resume>
      </AuiIf>
      <AuiIf
        condition={(s) =>
          s.composer.canCancel &&
          (s.thread.voice === undefined ||
            s.composer.submission !== undefined)
        }
      >
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-cancel size-7 rounded-full"
            aria-label={isSending ? "Cancel sending" : "Stop generating"}
          >
            <SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </>
  );

  if (ComposerExtra) {
    return (
      <div className="aui-composer-action-wrapper relative flex w-full flex-col gap-1.5">
        <ComposerExtra trailing={trailing} />
      </div>
    );
  }

  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <ComposerAddAttachment />
      <div className="aui-composer-action-end flex items-center gap-1.5">{trailing}</div>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

/** Keep the action bar inside the contained root's paint box, then cancel its reserved space in flow. */
const ACTION_BAR_PT = "pt-1.5";
const ACTION_BAR_HEIGHT = `min-h-7.5 ${ACTION_BAR_PT}`;

type AssistantPartInfo = Extract<
  Parameters<ThreadRowRender>[0],
  { type: "part" }
>;

/** False inside a turn shell so nested reasoning/text do not open a second bubble. */
const AssistantTurnChromeContext = createContext(true);

const AssistantPartRow: FC<{ info: AssistantPartInfo }> = ({ info }) => {
  const {
    ToolFallback: ToolFallbackComponent = ToolFallback,
    ToolGroup,
    ReasoningGroup,
    TaskGroup: TaskGroupComponent,
  } = useContext(ThreadComponentsContext);
  const wrapTurnChrome = useContext(AssistantTurnChromeContext);
  const { part, children } = info;

  let body: ReactNode = null;
  switch (part.type) {
    case "group-chainOfThought":
      // One shell for the whole turn: reasoning plate + tools + reply text.
      return (
        <div
          data-slot="aui_assistant-message-root"
          data-role="assistant"
          className="fade-in slide-in-from-bottom-1 animate-in duration-150"
        >
          <div
            data-slot="aui_assistant-message-content"
            className="aui-assistant-message-content text-foreground flex max-w-[min(100%,42rem)] flex-col gap-2 rounded-(--composer-radius) p-(--message-bubble-inset) text-sm leading-normal wrap-break-word"
          >
            <AssistantTurnChromeContext.Provider value={false}>
              {children}
            </AssistantTurnChromeContext.Provider>
          </div>
        </div>
      );
    case "group-task":
      body = TaskGroupComponent ? <TaskGroupComponent group={part} /> : null;
      break;
    case "group-tool":
      body = ToolGroup ? (
        <ToolGroup group={part}>{children}</ToolGroup>
      ) : (
        <DefaultToolGroup group={part}>{children}</DefaultToolGroup>
      );
      break;
    case "group-reasoning": {
      if (ReasoningGroup) {
        body = <ReasoningGroup group={part}>{children}</ReasoningGroup>;
        break;
      }
      const running = part.status.type === "running";
      body = (
        <ReasoningRoot streaming={running}>
          <ReasoningTrigger
            active={running}
            duration={reasoningDuration(part.timing)}
          />
          <ReasoningContent aria-busy={running}>
            <ReasoningText>{children}</ReasoningText>
          </ReasoningContent>
        </ReasoningRoot>
      );
      break;
    }
    case "text":
      body = <MarkdownText />;
      break;
    case "reasoning":
      body = <Reasoning {...part} />;
      break;
    case "tool-call":
      body = part.toolUI ?? <ToolFallbackComponent {...part} />;
      break;
    case "data":
      body = part.dataRendererUI;
      break;
    case "file":
      body = (
        <div data-slot="aui_assistant-message-file" className="py-1">
          <MessageFile {...part} />
        </div>
      );
      break;
    case "image":
      body = (
        <div data-slot="aui_assistant-message-image" className="py-1">
          <Image {...part} />
        </div>
      );
      break;
    case "indicator":
      body = (
        <span
          data-slot="aui_assistant-message-indicator"
          className="animate-pulse font-sans"
          aria-label="Assistant is working"
        >
          {"●"}
        </span>
      );
      break;
    default:
      body = null;
  }

  if (body === null || body === undefined) return null;

  // Nested under the turn shell: render the part only (reasoning plate, text, …).
  if (!wrapTurnChrome) return <>{body}</>;

  return (
    <div
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in duration-150"
    >
      <div
        data-slot="aui_assistant-message-content"
        className="aui-assistant-message-content text-foreground flex max-w-[min(100%,42rem)] flex-col gap-2 rounded-(--composer-radius) p-(--message-bubble-inset) text-sm leading-normal wrap-break-word"
      >
        {body}
      </div>
    </div>
  );
};

const AssistantTurnEnd: FC = () => (
  <div
    data-slot="aui_assistant-message-footer"
    className={cn("ms-2 flex flex-col", ACTION_BAR_HEIGHT)}
  >
    <MessageError />
    <div className="flex flex-col items-start gap-0.5">
      <AirAssistantActionBar />
      <BranchPicker />
    </div>
  </div>
);

const MessageFile: FileMessagePartComponent = (part) => {
  const image = part.mimeType.toLowerCase().startsWith("image/")
    ? getFileHref(part.data, part.mimeType, part.sourceType)
    : null;
  if (!image) return <File {...part} />;
  return (
    <Image
      type="image"
      image={image}
      status={part.status}
      {...(part.filename !== undefined && { filename: part.filename })}
    />
  );
};

const UserFilePart: FileMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-file" className="py-1">
    <MessageFile {...part} />
  </div>
);

const UserImagePart: ImageMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-image" className="py-1">
    <Image {...part} />
  </div>
);

/** Flat text part: Elements default wraps p > span, which makes the inset look uneven. */
const UserText: TextMessagePartComponent = ({ text, status }) => (
  <span
    data-slot="aui_user-message-text"
    data-status={status.type}
    className="block w-full whitespace-pre-line"
  >
    {text}
  </span>
);

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper col-start-2 min-w-0">
        <div className="aui-user-message-content bg-muted text-foreground rounded-(--composer-radius) p-(--message-bubble-inset) text-sm leading-normal wrap-break-word empty:hidden">
          <MessagePrimitive.Parts
            components={{
              Text: UserText,
              File: UserFilePart,
              Image: UserImagePart,
            }}
          />
        </div>
      </div>

      <div
        data-slot="aui_user-message-footer"
        className={cn("col-start-2 flex flex-col items-end gap-0.5", ACTION_BAR_HEIGHT)}
      >
        <AirUserActionBar />
        <BranchPicker
          data-slot="aui_user-branch-picker"
          className="-me-1 justify-end"
        />
      </div>
    </MessagePrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root ui-frost border-foreground/10 focus-within:border-foreground/25 ms-auto flex w-full max-w-[85%] cursor-text flex-col rounded-(--composer-radius) border shadow-[var(--shadow-pop,0_8px_24px_color-mix(in_srgb,var(--text-strong)_18%,transparent))] transition-[border-color]">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-12 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" className="h-8 px-3">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" className="h-8 px-3">
              Update
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium tabular-nums">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
