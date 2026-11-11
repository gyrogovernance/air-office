import { Button, Disclosure, Dropdown, type Selection } from '@heroui/react';
import { CollapsibleSection } from '../shared/collapsible-section.component';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { StageScrollbar } from '../workspace/stage-scrollbar.component';
import { useLocation } from 'react-router-dom';
import type { MethodDefinition } from '@office/methods/domain';
import { AssistantRuntimeProvider, ComposerPrimitive, unstable_useComposerInput, type ReasoningMessagePartProps } from '@assistant-ui/react';
import { Thread, type ThreadComponents } from '@/components/assistant-ui/elements/thread.aui';
import { TaskGroup } from '@/components/assistant-ui/elements/task-card.aui';
import { airChatAuiConfig } from './chat-elements-tools';
import { ChatWidgetInstructions } from './chat-generative-frame.composition';
import { ChatComposerExtra, ChatComposerTriggers, type ChatComposerExtraProps } from './chat-composer-extra.component';
import { ChatApprovalBanner, type ChatApprovalInput } from './chat-approval.component';
import { ChatMessageQueue } from './chat-message-queue.component';
import { StreamdownTextPrimitive } from '@assistant-ui/react-streamdown';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import type { KnowledgeWorkspaceState } from '../knowledge/knowledge-workspace.hook';
import { createServiceClient, type ServiceClient } from '../shared/service-client.hook';
import type { ChatRuntime } from './chat-runtime.hook';
import { ReasoningPanel } from './reasoning-panel.component';
import { MARKDOWN_COMPONENTS } from '../shared/markdown-table.component';
import { ChatCodeBlock } from './chat-code-block.component';
import { ChatCitationLink } from './chat-citation.component';
import { ChatRenderContext, useChatRenderContext, type ChatRenderContextValue } from './chat-render-context.composition';
import { ArtifactsPanel } from './chat-artifacts.component';
import { ModelCompare } from './model-compare.component';
import { parseMentions, mentionTargetsFrom, type MentionTarget } from './chat-mentions.policy';
import { linkifyWorkspacePaths } from './workspace-file-link.policy';
import { submitCodeToJobRunner } from './chat-rendering.policy';
import { type ComposerContextSelection, type ContextRetrievalOutcome } from './composer-context.policy';
import { type ModelLabelIcon } from '../models/local-ai/model-label.policy';
import { ChatAskBanner, type ChatAskInput, type ChatAskAnswer } from './chat-ask.component';
import { IconChevronDown, IconClose, IconPlus } from '../app/ui-icons.component';
import { ChatMessageActionsProvider } from './chat-message-actions.component';

const CHAT_RAIL_VIEWS = [
  { id: 'threads', label: 'Threads' },
  { id: 'branches', label: 'Reasoning' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'compare', label: 'Compare' },
] as const;

type ChatRailView = (typeof CHAT_RAIL_VIEWS)[number]['id'];

function isChatRailView(value: unknown): value is ChatRailView {
  return value === 'threads' || value === 'branches' || value === 'artifacts' || value === 'compare';
}

type ThreadSlotBag = {
  selection: string;
  selectionDocumentLabel?: string | null;
  onClearDocumentProposal: () => void;
  knowledgeResults: KnowledgeWorkspaceState['results'];
  attachedContextOutcome?: ContextRetrievalOutcome;
  toolApproval: ChatRailProps['toolApproval'];
  agentAsk: ChatRailProps['agentAsk'];
  composerExtra: ChatComposerExtraProps;
};

const ThreadSlotContext = createContext<ThreadSlotBag | null>(null);

/** Module-stable slot types: a new function identity remounts the composer and wipes typing. */
function StableAboveComposer() {
  const slot = useContext(ThreadSlotContext);
  if (!slot) return null;
  return <>
    {slot.selection ? <SelectionActions
      selection={slot.selection}
      documentLabel={slot.selectionDocumentLabel}
      onBeforeAction={slot.onClearDocumentProposal}
    /> : null}
    {slot.knowledgeResults.length > 0 && <CollapsibleSection className="grounded-context" title={`Retrieved · ${slot.knowledgeResults.length}`} bodyClassName="grounded-context-body">
      <ul>{slot.knowledgeResults.map((result) => <li key={result.chunkId}><span className={`citation ${result.resolved ? 'verified' : 'unverified'}`}>{result.resolved ? 'verified' : 'unverified'}</span> <span className="anchor">p.{result.anchor.page ?? '-'} · {result.sourceVersionId.slice(0, 12)}</span><p>{result.text.slice(0, 160)}</p></li>)}</ul>
    </CollapsibleSection>}
    {slot.attachedContextOutcome?.kind === 'retrieved' && <CollapsibleSection className="grounded-context" title={`Attached context · ${slot.attachedContextOutcome.results.length}`} bodyClassName="grounded-context-body">
      <ul>{slot.attachedContextOutcome.results.map((result) => <li key={result.chunkId}><span className={`citation ${result.resolved ? 'verified' : 'unverified'}`}>{result.resolved ? 'verified' : 'unverified'}</span> <span className="anchor">p.{result.anchor.page ?? '-'} · {result.sourceVersionId.slice(0, 12)}</span><p>{result.text.slice(0, 160)}</p></li>)}</ul>
    </CollapsibleSection>}
    {slot.attachedContextOutcome?.kind === 'no-match' && <p className="grounded-context-empty" role="status">Attached knowledge found no match for the last message.</p>}
    <ChatApprovalBanner approval={slot.toolApproval ?? null}/>
    <ChatAskBanner ask={slot.agentAsk ?? null}/>
    <ChatMessageQueue />
  </>;
}

function StableComposerExtra(props: { trailing?: ReactNode }) {
  const slot = useContext(ThreadSlotContext);
  if (!slot) return null;
  return <ChatComposerExtra {...slot.composerExtra} trailing={props.trailing} />;
}

const STABLE_THREAD_COMPONENTS: ThreadComponents = {
  TaskGroup,
  AboveComposer: StableAboveComposer,
  ComposerExtra: StableComposerExtra,
};

/**
 * The assistant rail on the assistant-ui runtime.
 *
 * The thread renders the projected branch of the service conversation graph; the composer,
 * the attached instructions, the retrieved context and the document proposal sit around it
 * because they decide what the next request carries before it leaves the machine.
 */

export type AttachedDefinition = MethodDefinition;

export interface ChatRailProps {
  onOpenStage?: () => void;
  onOpenRail?: () => void;
  inStage?: boolean;
  appearance?: 'light' | 'dark';
  runtime: ChatRuntime;
  selection: string;
  /** Open document title/name for the selection chip. */
  selectionDocumentLabel?: string | null;
  /** Drop an in-progress document proposal before another selection action. */
  onClearDocumentProposal: () => void;
  /** Insert a chat response into the open note through the proposal flow (CHAT-096). */
  onInsertIntoNote: (text: string) => void;
  /** Opens a connected-folder path created or edited by a Copilot file tool. */
  onOpenWorkspacePath?: (path: string) => void;
  onOpenCitation?: (versionId: string) => void;
  /** Mention targets for @Title and note links (CHAT-159), with the open action. */
  mentionTargets?: {
    notes?: Array<string | { id: string; title: string }>;
    files?: Array<string | { id: string; title: string }>;
    programs?: Array<string | { id: string; title: string }>;
    conversations?: Array<string | { id: string; title: string }>;
  };
  onOpenMention?: (target: MentionTarget) => void;
  commandPermission?: 'ask' | 'allow-all';
  onCommandPermission?: (value: 'ask' | 'allow-all') => void;
  /** Null means the selected model has not reported image support. */
  imagesAccepted?: boolean | null;
  attached: AttachedDefinition[];
  attachedInstructions: string;
  missingVariables: string[];
  promptValues: Record<string, Record<string, string>>;
  onPromptValue: (definitionId: string, name: string, value: string) => void;
  onDetachAll: () => void;
  /** Opens Prompts, or the matching Agents or Skills section, to change what is attached. */
  onEditAttached?: () => void;
  agentPreview?: Extract<MethodDefinition, { kind: 'preset' }>;
  agentKnowledgePreview: string;
  agentKnowledgeSources?: KnowledgeWorkspaceState['results'];
  knowledge: KnowledgeWorkspaceState;
  /** The knowledge attached to the next message, and how it changes. */
  contextSelection: ComposerContextSelection;
  onContextSelectionChange: (selection: ComposerContextSelection) => void;
  /** What the last search of the attached context produced, so an empty answer is visible. */
  attachedContextOutcome?: ContextRetrievalOutcome;
  models: { value: string; label: string; icon?: ModelLabelIcon }[];
  selectedModel: string;
  onSelectModel: (value: string) => void;
  /** Agents available for the next turn; empty value means no agent. */
  agents: { value: string; label: string }[];
  selectedAgent: string;
  onSelectAgent: (value: string) => void;
  /** Opens Agents settings to create or edit agents. */
  onAgentSetup?: () => void;
  /** Compact reasoning effort control; omitted when the selected model has no levels. */
  reasoningLevels?: { value: string; label: string }[];
  reasoningEffort?: string;
  onReasoningEffort?: (value: string) => void;
  onModelSetup?: () => void;
  /** Opens the Market, where models can be found and downloaded. */
  onFindModels?: () => void;
  /**
   * The local models the runtime holds, so a reply can be read aloud by the
   * speech model among them.
   */
  localModels?: { id: string; labels: string[] }[];
  activeFileName: string | null;
  /** Host outside the rail foreground so the composer can frost the thread beneath it. */
  dockHost?: RefObject<HTMLElement | null>;
  headerHost?: HTMLElement | null;
  /** When true, typing / opens assistant-ui slash commands for skills and prompts. */
  slashCommandsEnabled?: boolean;
  slashCommands?: { id: string; label: string; description: string }[];
  onSlashCommand?: (id: string) => void;
  /** Active assistant question shown above the composer when the run needs an answer. */
  agentAsk?: (ChatAskInput & { id: string; resolve: (value: ChatAskAnswer | null) => void }) | null;
  /** Active Ask-first tool approval shown as an Elements ApprovalCard above the composer. */
  toolApproval?: (ChatApprovalInput & { id: string; resolve: (value: boolean) => void }) | null;
}

const PLUGINS = { code, math, mermaid };

/**
 * Chat markdown builds on the shared Guides MARKDOWN_COMPONENTS (HeroUI tables
 * and the markdown-code-block shell). Chat adds citation links and dedicated
 * diff/JSON bodies.
 */
export const CHAT_MESSAGE_COMPONENTS = {
  ...MARKDOWN_COMPONENTS,
  code: ChatCodeBlock,
  a: ChatCitationLink,
};

/** Mention navigation context: the shell supplies targets and the open action (CHAT-159). */
const MentionContext = createContext<{ targets: MentionTarget[]; onOpenMention: (target: MentionTarget) => void }>({ targets: [], onOpenMention: () => undefined });
const useMentionNavigation = () => useContext(MentionContext);

function MentionText(props: { text: string }) {
  const { targets, onOpenMention } = useMentionNavigation();
  const segments = useMemo(() => parseMentions(props.text, targets), [props.text, targets]);
  if (!segments.some((segment) => segment.kind === 'mention')) return <>{props.text}</>;
  return <>{segments.map((segment, index) => segment.kind === 'mention' && segment.target
    ? <button key={index} type="button" className="chat-mention" data-kind={segment.target.kind} title={`Open ${segment.target.kind} ${segment.target.title}`} onClick={() => onOpenMention(segment.target!)}>{segment.text}</button>
    : <span key={index}>{segment.text}</span>)}</>;
}

const MarkdownText = ({ text }: { text?: string }) => {
  const { targets } = useMentionNavigation();
  const { openWorkspacePath } = useChatRenderContext();
  if (text && targets.length && /(^|\s)@[\w]|\]\(note:/.test(text)) return <p className="thread-text"><MentionText text={text}/></p>;
  return <div className="prose"><StreamdownTextPrimitive
    plugins={PLUGINS}
    components={CHAT_MESSAGE_COMPONENTS}
    lineNumbers={false}
    parseIncompleteMarkdown
    controls={{ code: false, table: false, mermaid: true }}
    {...(openWorkspacePath ? { preprocess: linkifyWorkspacePaths } : {})}
  /></div>;
};

const MessageChromeContext = createContext<{ branchNav: ReactNode }>({ branchNav: null });

/**
 * assistant-ui contract: the host stamps `timing` on each reasoning part.
 * Duration is shown only once `completedAt` is known; a local latch keeps the
 * resting label stable if a reload briefly drops those fields.
 */
export function ReasoningPart({ text, status, timing }: ReasoningMessagePartProps) {
  const { branchNav } = useContext(MessageChromeContext);
  const running = status.type === 'running';
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const startedRef = useRef<number | null>(timing?.startedAt ?? null);
  const latchedSecondsRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (timing?.startedAt != null) startedRef.current = timing.startedAt;
  }, [timing?.startedAt]);
  useEffect(() => {
    if (!running) return;
    if (startedRef.current == null) startedRef.current = timing?.startedAt ?? Date.now();
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running, timing?.startedAt]);
  const timedSeconds = timing?.completedAt != null && timing.startedAt != null
    ? Math.max(1, Math.round((timing.completedAt - timing.startedAt) / 1000))
    : null;
  if (timedSeconds != null) latchedSecondsRef.current = timedSeconds;
  useEffect(() => {
    if (running || latchedSecondsRef.current != null || startedRef.current == null) return;
    latchedSecondsRef.current = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000));
  }, [running]);
  const thoughtSeconds = timedSeconds ?? latchedSecondsRef.current;
  const liveSeconds = running && startedRef.current != null
    ? Math.max(0, Math.round((now - startedRef.current) / 1000))
    : null;
  const open = running || manuallyOpen;
  const label = running
    ? liveSeconds && liveSeconds > 0 ? `Thinking · ${liveSeconds}s` : 'Thinking…'
    : status.type === 'incomplete'
      ? 'Reasoning stopped'
      : thoughtSeconds != null ? `Thought for ${thoughtSeconds}s` : 'Done thinking';
  if (!text && !running) return null;
  return <Disclosure className="chat-reasoning" data-status={status.type} isExpanded={open} onExpandedChange={(next) => { if (!running) setManuallyOpen(next); }}>
    <div className="message-chrome-row">
      <Disclosure.Heading>
        <Button className="chat-reasoning-summary" slot="trigger" size="sm" variant="secondary" isDisabled={running}>
          <span className="chat-reasoning-label">{label}</span>
          {!running && <Disclosure.Indicator />}
        </Button>
      </Disclosure.Heading>
      {branchNav}
    </div>
    <Disclosure.Content>
      <Disclosure.Body className="chat-reasoning-body"><p>{text}</p></Disclosure.Body>
    </Disclosure.Content>
  </Disclosure>;
}

function SelectionActions(props: {
  selection: string;
  documentLabel?: string | null;
  onBeforeAction: () => void;
}) {
  const composer = unstable_useComposerInput();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const selection = props.selection.trim();
  const hidden = !selection || dismissedFor === selection;
  const preview = selection.length > 96 ? `${selection.slice(0, 96).trimEnd()}…` : selection;
  const source = props.documentLabel?.trim() || 'Open document';
  const ask = () => {
    props.onBeforeAction();
    composer.setText(`Regarding this selection from ${source}:\n\n${selection}\n\n`);
  };
  const explain = () => {
    props.onBeforeAction();
    composer.setText(`Explain this selection from ${source}:\n\n${selection}\n\n`);
    composer.send();
  };
  if (hidden) return null;
  return <div className="chat-context" role="group" aria-label="Document selection">
    <div className="chat-context-head">
      <span className="chat-context-label">From {source}</span>
      <Button isIconOnly variant="ghost" size="sm" className="compose-chip-remove" aria-label="Dismiss selection actions" onPress={() => setDismissedFor(selection)}><IconClose/></Button>
    </div>
    <p className="chat-context-preview">{preview}</p>
    <div className="chat-context-actions">
      <Button className="chat-context-action" variant="tertiary" size="sm" onPress={explain}>Explain</Button>
      <Button className="chat-context-action" variant="tertiary" size="sm" onPress={ask}>Ask</Button>
    </div>
  </div>;
}

export function ChatRail(props: ChatRailProps) {
  const { runtime, knowledge } = props;
  const { pathname } = useLocation();
  const attachedContextOutcome = props.attachedContextOutcome;
  const [railView, setRailView] = useState<ChatRailView>('threads');
  const wasInStage = useRef(props.inStage);
  useEffect(() => {
    if (wasInStage.current && !props.inStage) setRailView((view) => view === 'compare' ? 'threads' : view);
    wasInStage.current = props.inStage;
  }, [props.inStage]);
  const overviewOpen = railView === 'branches';
  const artifactsOpen = railView === 'artifacts';
  const compareOpen = railView === 'compare';
  const setOverviewOpen = (open: boolean) => setRailView(open ? 'branches' : 'threads');
  const railViewLabel = CHAT_RAIL_VIEWS.find((view) => view.id === railView)?.label ?? 'Threads';
  const chooseRailView = (keys: Selection) => {
    if (keys === 'all') return;
    const key = [...keys][0];
    if (!isChatRailView(key)) return;
    if (key === 'compare' && !props.inStage) props.onOpenStage?.();
    setRailView(key);
  };
  const serviceClient: ServiceClient = useMemo(() => createServiceClient(), []);
  const mentionTargets = useMemo(() => mentionTargetsFrom(props.mentionTargets ?? {}), [props.mentionTargets]);
  const renderContext = useMemo<ChatRenderContextValue>(() => ({
    citation: {
      versions: knowledge.versions,
      results: [...knowledge.results, ...(props.agentKnowledgeSources ?? [])].map((result) => ({ versionId: result.sourceVersionId, resolved: result.resolved }))
    },
    openCitation: props.onOpenCitation,
    openWorkspacePath: props.onOpenWorkspacePath,
    submitCodeJob: (code, language) => submitCodeToJobRunner(serviceClient, code, language),
  }), [knowledge, props.agentKnowledgeSources, props.onOpenWorkspacePath, props.onOpenCitation, serviceClient]);

  useEffect(() => {
    const target = parseChatTarget(pathname);
    if (!target) return;
    const scroller = document.getElementById('rail-right-chat-scroll');
    const element = scroller?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(target)}"]`);
    element?.scrollIntoView({ block: 'center' });
  }, [pathname, runtime.conversationId]);

  useEffect(() => {
    const host = document.querySelector(props.inStage ? '.stage-chat' : '.rail-right-scene');
    if (!(host instanceof HTMLElement)) return;
    if (overviewOpen || artifactsOpen || compareOpen) {
      host.style.setProperty('--chat-composer-height', '0px');
      host.style.removeProperty('--thread-composer-clearance');
      return;
    }
    let observer: ResizeObserver | undefined;
    const attach = () => {
      const footer = document.querySelector('.assistance-thread-view .aui-thread-viewport-footer');
      if (!(footer instanceof HTMLElement)) return false;
      const measure = () => {
        const height = Math.ceil(footer.getBoundingClientRect().height);
        if (height > 0) {
          /* Drives shell-bottom-frost height and left-edge fade behind the sticky composer. */
          host.style.setProperty('--chat-composer-height', `${height}px`);
          host.style.setProperty('--thread-composer-clearance', `${height}px`);
        }
      };
      measure();
      if (typeof ResizeObserver === 'undefined') return true;
      observer?.disconnect();
      observer = new ResizeObserver(measure);
      observer.observe(footer);
      return true;
    };
    if (attach()) return () => observer?.disconnect();
    const timer = window.setInterval(() => {
      if (attach()) window.clearInterval(timer);
    }, 50);
    return () => {
      window.clearInterval(timer);
      observer?.disconnect();
    };
  }, [props.inStage, overviewOpen, artifactsOpen, compareOpen, runtime.conversationId]);

  const messageActions = useMemo(() => ({
    runtime,
    client: serviceClient,
    localModels: props.localModels ?? [],
    onInsertIntoNote: props.onInsertIntoNote,
    appearance: props.appearance,
  }), [runtime, serviceClient, props.localModels, props.onInsertIntoNote, props.appearance]);

  const threadSlots = useMemo<ThreadSlotBag>(() => ({
    selection: props.selection,
    selectionDocumentLabel: props.selectionDocumentLabel,
    onClearDocumentProposal: props.onClearDocumentProposal,
    knowledgeResults: knowledge.results,
    attachedContextOutcome,
    toolApproval: props.toolApproval ?? null,
    agentAsk: props.agentAsk ?? null,
    composerExtra: {
      conversationId: runtime.conversationId,
      inStage: props.inStage,
      onOpenStage: props.onOpenStage,
      onOpenRail: props.onOpenRail,
      commandPermission: props.commandPermission,
      onCommandPermission: props.onCommandPermission,
      models: props.models,
      selectedModel: props.selectedModel,
      onSelectModel: props.onSelectModel,
      agents: props.agents,
      selectedAgent: props.selectedAgent,
      onSelectAgent: props.onSelectAgent,
      onAgentSetup: props.onAgentSetup,
      reasoningLevels: props.reasoningLevels,
      reasoningEffort: props.reasoningEffort,
      onReasoningEffort: props.onReasoningEffort,
      onModelSetup: props.onModelSetup,
      imagesAccepted: props.imagesAccepted ?? null,
      slashCommandsEnabled: props.slashCommandsEnabled,
      slashCommands: props.slashCommands,
      onSlashCommand: props.onSlashCommand,
      knowledge: props.knowledge,
      contextSelection: props.contextSelection,
      onContextSelectionChange: props.onContextSelectionChange,
    },
  }), [props.selection, props.selectionDocumentLabel, props.onClearDocumentProposal, knowledge.results, attachedContextOutcome, props.toolApproval, props.agentAsk, runtime.conversationId, props.inStage, props.onOpenStage, props.onOpenRail, props.commandPermission, props.onCommandPermission, props.models, props.selectedModel, props.onSelectModel, props.agents, props.selectedAgent, props.onSelectAgent, props.onAgentSetup, props.reasoningLevels, props.reasoningEffort, props.onReasoningEffort, props.onModelSetup, props.imagesAccepted, props.slashCommandsEnabled, props.slashCommands, props.onSlashCommand, props.knowledge, props.contextSelection, props.onContextSelectionChange]);

  const header = (
    <div className="sidebar-view-pill" role="group" aria-label="Chat view actions">
      <Dropdown>
        <Button className="chat-view-trigger" variant="ghost" size="sm" aria-label="Chat view">
          <span className="chat-view-trigger-label">{railViewLabel}</span>
          <IconChevronDown className="chat-view-trigger-chevron" aria-hidden="true"/>
        </Button>
        <Dropdown.Popover className="chat-view-popover" placement="bottom start">
          <Dropdown.Menu
            aria-label="Chat view"
            className="chat-view-menu"
            selectionMode="single"
            selectedKeys={new Set([railView])}
            onSelectionChange={chooseRailView}
          >
            {CHAT_RAIL_VIEWS.map((view) => (
              <Dropdown.Item key={view.id} id={view.id} textValue={view.label} className="chat-view-menu-item">
                {view.label}
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      <Button
        isIconOnly
        className="sidebar-view-new"
        variant="ghost"
        size="sm"
        aria-label="New chat"
        isDisabled={runtime.sending}
        onPress={() => { setOverviewOpen(false); runtime.newConversation(); }}
      ><IconPlus/></Button>
    </div>
  );

  return <AssistantRuntimeProvider runtime={runtime.assistantRuntime} config={airChatAuiConfig}>
  <ChatWidgetInstructions />
  <MentionContext.Provider value={{ targets: mentionTargets, onOpenMention: props.onOpenMention ?? (() => undefined) }}>
  {props.headerHost ? createPortal(header, props.headerHost) : header}

    {overviewOpen && <ReasoningPanel appearance={props.appearance} graph={runtime.graph} leafId={parseChatTarget(pathname)} client={serviceClient} onSelectMessage={(id) => { void runtime.open(runtime.conversationId, id); setOverviewOpen(false); }}/>}

    {artifactsOpen && <ArtifactsPanel graph={runtime.graph}/>}

    {compareOpen && <ModelCompare appearance={props.appearance} client={serviceClient} models={props.models} onOpenConversation={(id) => { setRailView('threads'); void runtime.open(id, undefined, !props.inStage); }}/>}

    <div className="assistance-thread-view" hidden={overviewOpen || artifactsOpen || compareOpen}>
      <ChatRenderContext.Provider value={renderContext}>
        <ChatMessageActionsProvider {...messageActions}>
        <ThreadSlotContext.Provider value={threadSlots}>
          <ComposerPrimitive.TriggerPopoverRoot>
            <ChatComposerTriggers
              slashCommandsEnabled={props.slashCommandsEnabled}
              slashCommands={props.slashCommands}
              onSlashCommand={props.onSlashCommand}
              knowledge={props.knowledge}
              contextSelection={props.contextSelection}
              onContextSelectionChange={props.onContextSelectionChange}
            />
            <Thread components={STABLE_THREAD_COMPONENTS} />
          </ComposerPrimitive.TriggerPopoverRoot>
        </ThreadSlotContext.Provider>
        </ChatMessageActionsProvider>
      </ChatRenderContext.Provider>
    </div>
    {props.inStage && !overviewOpen && !artifactsOpen && !compareOpen && <StageScrollbar scrollerId="rail-right-chat-scroll" top="60px" bottom="12px"/>}

  </MentionContext.Provider>
  </AssistantRuntimeProvider>;
}


function parseChatTarget(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'chat' || parts[2] !== 'm') return null;
  return parts[3] ?? null;
}
