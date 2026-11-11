import { createPortal } from 'react-dom';
import { Activity, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LocalAiPower } from '../models/local-ai/local-ai-power.component';
import { closeVisitedWorkspace, traverseWorkspace, visitWorkspace, type WorkspaceNavigation } from './workspace-navigation.policy';
import type { FileSnapshot } from '@office/contracts/file';
import { CHAT_NOTE_FILE_ID_PREFIX, type ChatRunRequest, type ChatTurn } from '@office/contracts/chat';
import { createDocumentBuffer, draftKey, isDocumentDirty, saveDocumentBuffer, type DocumentBuffer } from '@office/editor/domain';
import { closeStageSurface, openStageSurface, reconcileStageScope, restoreStageState, type StageState, type StageSurface } from '@office/workspace/domain';
import { createRichDocument, documentMarkdown, emptyNativeBody, ensureNativeRichDocument, exportRichDocument, markdownToNativeBody, validateRichDocument, type RichDocument } from '@office/editor/rich-document-domain';
import { resolveMethodInstructions } from '@office/methods/domain';
import type { MethodDefinition } from '@office/methods/domain';
import { AIR_OFFICE_AGENT_ID } from '@office/lab-pack/domain';
const RichDocumentEditorView = lazy(() => import('../workspace/rich-document-editor-view.component').then((module) => ({ default: module.RichDocumentEditorView })));
import { SourceEditor } from '@office/editor/source-ui';
import {
  type LobeDocumentEditorProps,
  type DocumentAIProposal,
  createDocumentAIProposal,
  isProposalStale,
  applyProposalToEditor
} from '@office/editor/ui';
import { useMethodsWorkspace } from '../market/methods-workspace.hook';
import { SettingsWorkspace, type SettingsSection } from '../settings/settings-workspace.component';
import { applyNativeInterfaceZoom } from '../settings/apply-interface-zoom';
import { DOCUMENT_SCALE_VALUES, INTERFACE_SCALE_VALUES, layoutViewportSize, readDocumentScaleChoice, readInterfaceScaleChoice, resolveInterfaceScale } from '../settings/display-scale.policy';
import { chatSlashCommandsEnabled, knowledgeSearchOptions, noticeDurationMs, PERSONAL_SETTINGS_KEY, readSettingsValues, workspaceRestoresStage } from '../settings/settings.store';
import { GlassButton, GlassContent, GlassForeground, GlassMenu, GlassMenuContent, GlassMenuItem, GlassMenuSeparator, GlassMenuTrigger, GlassScene, GlassSurface, GlassToolbar, GlassToolbarButton } from '@glass-sdk/liquid-glass';
import { FrostScrim } from '@office/ui-kit/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { AiChat02Icon, UserCircleIcon } from '@hugeicons/core-free-icons';
import { Button, Switch, Toast, toast } from '@heroui/react';
import { ChromeFloatingTipHost } from '../shared/chrome-floating-tip';
import { ChromeTooltip } from '../shared/chrome-tooltip.component';
import { MenuSwitchRow } from '../shared/menu-switch-row.component';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrowserFileAdapter } from '../adapters/service/browser-file.adapter';
import { useProviderCatalog } from '../models/providers-catalog.hook';
import { useKnowledgeWorkspace } from '../knowledge/knowledge-workspace.hook';
import { contextCollectionIds, contextRetrievalNotice, contextRetrievalOutcome, EMPTY_CONTEXT_SELECTION, type ComposerContextSelection, type ContextRetrievalOutcome } from '../chat/composer-context.policy';
import { createServiceClient } from '../shared/service-client.hook';
import { useInstalledLocalModels } from '../models/local-ai/local-ai-installed-models.hook';
import { answerAgentQuestion, confirmToolPermission, useAppDialogs } from '../shared/app-dialogs.component';
import { StageScrollbar } from '../workspace/stage-scrollbar.component';
import { LineWaves } from './line-waves.component';
import { IconArrowUp, IconChevronDown, IconChevronLeft, IconChevronRight, IconClose, IconEdit, IconFile, IconFolder, IconMore, IconPanelLeft, IconPanelRight, IconPlus, IconRefresh, IconSave, IconSettings, IconStop } from './ui-icons.component';
import { ChatRail } from '../chat/chat-rail.component';
import { useChatAskQueue } from '../chat/chat-ask.component';
import { useChatApprovalQueue } from '../chat/chat-approval.component';
import { connectedFileTarget, resolveWorkspaceOpenTarget } from '../chat/workspace-file-link.policy';
import { NoteProjectionConflict } from '../workspace/note-projection-conflict.component';
import { useNoteProjectionDrift } from './note-projection-drift.hook';
import { ProgramExplorer, type ProgramExplorerControls } from '../shared/program-explorer.component';
import { WorkspaceSearch } from '../workspace/workspace-search.component';
import { createExplorerFileClient, externalFileId, externalFileTarget } from '../shared/explorer-file.adapter';
import { ExternalFilePreview } from '../workspace/external-file-preview.component';
import { KnowledgeSourceView } from '../knowledge/knowledge-source-view.component';
import type { ConnectedRoot, FilesystemTarget } from '@office/files/domain';
import { createConversationClient } from '../chat/conversation-client.adapter';
import { streamRun } from '../chat/run-stream.adapter';
import { useChatRuntime } from '../chat/chat-runtime.hook';
import { effectiveToolIds, inheritedChatSettings, parseModelKey, readChatSettings, reasoningEffortLabel, reasoningOptionsForModel, resolveChatSettings, withModelOverride, withReasoningEffortForModel, writeChatSettings, type ChatComposerSettings } from '../chat/composer.policy';
import { isChatReasoningEffort } from '@office/contracts/chat';
import { SidebarNavigation, type LeftRailMode, type RightRailMode } from './sidebar-navigation.component';
import { LauncherHome } from './launcher-home.component';
import { WelcomeIdeas } from './welcome-ideas.component';
import { AssistantDirectory } from '../chat/assistant-directory.component';
import { TodayBriefing } from '../workspace/today-briefing.component';
import { CalendarWorkspace } from '../calendar/calendar-workspace.component';
import { TeamsWorkspace } from '../market/teams-workspace.component';
import { MarketWorkspace } from '../market/market-workspace.component';
import { WorkplaceMediaWorkspace } from '../media/workplace-media-workspace.component';
import { chatModelChoices } from '../models/local-ai/model-label.policy';
import { useModelVisibility } from '../models/model-visibility.hook';
import { NotesWorkspace } from '../market/prompts-workspace.component';
import { AppsWorkspace } from '../market/apps-workspace.component';
import { ArcadeWorkspace } from '../media/arcade-workspace.component';
import { GlossaryWorkspace } from '../market/glossary-workspace.component';
import { CraftWorkspace, FellowshipWorkspace } from './fellowship-workspace.component';
import { CodeWorkspace, type CodeRevealRequest } from './code-workspace.component';
import { isWorkspaceSurfaceId, parseWorkspaceRoute, settingsPath, workspacePath, type WorkspaceSurfaceId } from './workspace-routing.policy';
import { ProgramsWorkspace } from './programs-workspace.component';
import { craftSubmissionMarkdown, craftSubmissionTitle, fellowshipResearchMarkdown, fellowshipResearchTitle, type FellowshipOfficeDestination, type FellowshipPlan, type FellowshipReviewAppId } from './fellowship-workspace.policy';
import { filePreparedNote as filePreparedNoteInWorkspace, prepareResearchProject } from './fellowship-workspace.adapter';
import type { ProjectReview } from '../market/app-review.policy';
import type { WorkspaceNode } from '@office/workspace/domain';
import { publicAsset } from '../static-demo/public-asset';

const stageStateKey = 'air-office:stage-state-v1';

function formatLocalClock(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
}

/** Local wall-clock label for the welcome title; refreshes on each minute. */
function useLocalClockLabel(): string {
  const [label, setLabel] = useState(() => formatLocalClock(new Date()));
  useEffect(() => {
    const refresh = () => setLabel(formatLocalClock(new Date()));
    refresh();
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    let intervalId = 0;
    const timeoutId = window.setTimeout(() => {
      refresh();
      intervalId = window.setInterval(refresh, 60_000);
    }, Math.max(msToNextMinute, 0));
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);
  return label;
}

/** Turns a provider connection id into a label a person can read. */
function providerLabel(id: string): string {
  if (id === 'local-replay') return 'Demo model';
  if (id === 'openai') return 'OpenAI-compatible';
  if (id === 'ollama') return 'Ollama';
  return id;
}
function isMarkdownFile(name: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(name);
}

type FileRichEdit = { source: string; document: RichDocument; saved?: boolean };

/** Welcome is `activeId: null`. Tabs may stay open, but none is current — otherwise
 *  clearing the Welcome overlay resurrects whatever surface was left selected. */
export function withWelcomeSelected(state: StageState): StageState {
  return state.activeId === null ? state : { ...state, activeId: null };
}

function restoreStage(): StageState {
  if (!workspaceRestoresStage()) return restoreStageState(null);
  try {
    const restored = restoreStageState(JSON.parse(localStorage.getItem(stageStateKey) ?? localStorage.getItem('air-office:stage-tabs-v1') ?? 'null'), localStorage.getItem('air-office:active-stage-tab'));
    // Cold start on `/` must not keep a prior surface selected under Welcome.
    if (window.location.pathname === '/' || window.location.pathname === '') return withWelcomeSelected(restored);
    return restored;
  } catch { return restoreStageState(null); }
}

const RAIL_MIN = 280;
const RAIL_MAX = 420;
const RAIL_DEFAULT = 320;
/** Preferred rail width as a fraction of the viewport; stage keeps the rest. */
const RAIL_SHARE_DEFAULT = 0.2;
const RAIL_SHARE_FLOOR = 0.12;
const RAIL_SHARE_CEIL = 0.4;
const LEFT_MIN = RAIL_MIN;
const LEFT_MAX = RAIL_MAX;
const RIGHT_MIN = RAIL_MIN;
const RIGHT_MAX = RAIL_MAX;
const STAGE_MIN = 400;
const SHELL_CHROME = 32;
/** Below this stage width, collapsed-rail chrome can sit under OS titlebar controls. */
const TITLEBAR_SAFE_STAGE_MAX = 600;
const COMPACT_MAX = STAGE_MIN + RIGHT_MIN + SHELL_CHROME - 1;
const ALL_PANELS_MIN = STAGE_MIN + LEFT_MIN + RIGHT_MIN + SHELL_CHROME;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Stored values are viewport shares (0–1). Legacy absolute pixels (>1) migrate once. */
function readRailShare(key: string, viewport: number): number {
  const raw = localStorage.getItem(key);
  const parsed = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return RAIL_SHARE_DEFAULT;
  if (parsed > 1) {
    const share = clamp(parsed / Math.max(viewport, 1), RAIL_SHARE_FLOOR, RAIL_SHARE_CEIL);
    try { localStorage.setItem(key, String(share)); } catch { /* Keep the in-memory share when storage is full. */ }
    return share;
  }
  return clamp(parsed, RAIL_SHARE_FLOOR, RAIL_SHARE_CEIL);
}
function preferredRailWidth(share: number, viewport: number, minimum: number, maximum: number) {
  return clamp(Math.round(share * viewport), minimum, maximum);
}
function persistRailShare(side: 'left' | 'right', width: number, viewport: number) {
  const share = clamp(width / Math.max(viewport, 1), RAIL_SHARE_FLOOR, RAIL_SHARE_CEIL);
  localStorage.setItem(`air-office:${side}-width`, String(share));
  return share;
}
function isCompactViewport() {
  return window.matchMedia(`(max-width: ${COMPACT_MAX}px)`).matches;
}
/**
 * Which side panels start open, given the viewport and the stored choices.
 *
 * A compact viewport shows no side panel. A viewport too narrow for both
 * panels shows the files panel only when the assistant is closed.
 */
export function restorePanelPreferences(viewport: number, compact: boolean, stored: { filesOpen: boolean; chatOpen: boolean }): { files: boolean; chat: boolean } {
  if (compact) return { files: false, chat: false };
  const chat = stored.chatOpen;
  const files = viewport < ALL_PANELS_MIN && chat ? false : stored.filesOpen;
  return { files, chat };
}
const THEME_KEY = 'air-office:theme';
type ThemeChoice = 'light' | 'dark' | 'system';
function restoreThemeChoice(): ThemeChoice {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}
function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  return choice === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : choice;
}
function stageFloorFor(viewport: number) {
  return viewport <= COMPACT_MAX ? 0 : STAGE_MIN;
}
function railLimitsFor(viewport: number, side: 'left' | 'right') {
  const minimum = side === 'left' ? LEFT_MIN : RIGHT_MIN;
  const maximum = side === 'left' ? LEFT_MAX : RIGHT_MAX;
  return { min: minimum, max: Math.max(minimum, Math.min(maximum, viewport - SHELL_CHROME - STAGE_MIN)) };
}
function fitRailWidths(viewport: number, left: number, right: number, leftOpen: boolean, rightOpen: boolean) {
  if (viewport <= COMPACT_MAX) {
    const width = Math.max(0, viewport - SHELL_CHROME);
    return { left: leftOpen ? width : 0, right: rightOpen ? width : 0 };
  }
  const leftLimits = railLimitsFor(viewport, 'left');
  const rightLimits = railLimitsFor(viewport, 'right');
  const leftMinimum = leftOpen ? leftLimits.min : 0;
  const rightMinimum = rightOpen ? rightLimits.min : 0;
  const leftExtra = leftOpen ? clamp(left, leftLimits.min, leftLimits.max) - leftMinimum : 0;
  const rightExtra = rightOpen ? clamp(right, rightLimits.min, rightLimits.max) - rightMinimum : 0;
  const extra = leftExtra + rightExtra;
  const available = Math.max(0, viewport - SHELL_CHROME - STAGE_MIN - leftMinimum - rightMinimum);
  const scale = extra > 0 ? Math.min(1, available / extra) : 1;
  return { left: leftMinimum + Math.floor(leftExtra * scale), right: rightMinimum + Math.floor(rightExtra * scale) };
}

const workspaceSurfaces = {
  programs: { id: 'programs', kind: 'programs', title: 'Programs' },
  arcade: { id: 'arcade', kind: 'arcade', title: 'Arcade' },
  code: { id: 'code', kind: 'code', title: 'Code' },
  today: { id: 'today', kind: 'today', title: 'Today' },
  calendar: { id: 'calendar', kind: 'calendar', title: 'Calendar' },
  teams: { id: 'teams', kind: 'teams', title: 'Teams' },
  market: { id: 'market', kind: 'market', title: 'Market' },
  media: { id: 'media', kind: 'media', title: 'Media' },
  search: { id: 'search', kind: 'search', title: 'Search' },
  apps: { id: 'apps', kind: 'apps', title: 'Actions' },
  fellowship: { id: 'fellowship', kind: 'fellowship', title: 'Fellowship' },
  craft: { id: 'craft', kind: 'craft', title: 'Craft' },
  prompts: { id: 'prompts', kind: 'prompts', title: 'Notes' },
  glossary: { id: 'glossary', kind: 'glossary', title: 'Guides' },
} satisfies { [K in WorkspaceSurfaceId]: Extract<StageSurface, { kind: K }> };

function StageProfileMenu({ appearance, onTheme, onSettings }: {
  appearance: 'light' | 'dark';
  onTheme: (theme: 'light' | 'dark' | 'system') => void;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuAppearance = useRef(appearance);
  const keepOpenUntil = useRef(0);
  if (!open) menuAppearance.current = appearance;
  function setMenuOpen(next: boolean) {
    if (!next && Date.now() < keepOpenUntil.current) {
      setOpen(true);
      return;
    }
    setOpen(next);
  }
  return (
    <GlassToolbar className="profile-toolbar" aria-label="Profile and settings" material="regular" appearance={menuAppearance.current}>
      <GlassMenu open={open} onOpenChange={setMenuOpen}>
        <GlassToolbarButton
          className="profile-button"
          size="icon"
          aria-label="Profile and settings"
          render={<GlassMenuTrigger />}
        >
          <HugeiconsIcon icon={UserCircleIcon} size={22}/>
        </GlassToolbarButton>
        <GlassMenuContent className="workspace-menu ui-frost" align="end" material="regular" appearance={menuAppearance.current} morph="detach" side="bottom">
          <MenuSwitchRow
            label="Appearance"
            ariaLabel="Appearance"
            isSelected={appearance === 'dark'}
            onChange={(checked) => {
              keepOpenUntil.current = Date.now() + 400;
              setOpen(true);
              onTheme(checked ? 'dark' : 'light');
            }}
          />
          <GlassMenuSeparator/>
          <GlassMenuItem onClick={onSettings}><IconSettings/>Settings</GlassMenuItem>
        </GlassMenuContent>
      </GlassMenu>
    </GlassToolbar>
  );
}

export function WorkspaceShell() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const localClock = useLocalClockLabel();
  const [leftMode, setLeftMode] = useState<LeftRailMode>(() => { const stored = localStorage.getItem('air-office:left-mode'); return stored === 'files' ? 'files' : 'home'; });
  const [rightMode, setRightMode] = useState<RightRailMode>(() => { const stored = localStorage.getItem('air-office:right-mode'); return stored === 'directory' ? 'directory' : stored === 'chat' || pathname.startsWith('/chat/') ? 'chat' : 'directory'; });
  useEffect(() => { localStorage.setItem('air-office:left-mode', leftMode); }, [leftMode]);
  useEffect(() => { localStorage.setItem('air-office:right-mode', rightMode); }, [rightMode]);
  useEffect(() => { if (pathname.startsWith('/chat/')) setRightMode('chat'); }, [pathname]);
  const appliedInterfaceZoom = useRef<string | null>(null);
  const resolvedInterfaceBand = useRef<ReturnType<typeof resolveInterfaceScale> | null>(null);
  const lastAutoOuter = useRef<{ width: number; height: number } | null>(null);
  const zoomSettleUntil = useRef(0);
  const zoomApplyTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  useEffect(() => {
    const applyDisplayScale = (source: 'startup' | 'prefs' | 'resize') => {
      /* After setZoom, the desktop webview emits resize while layout settles.
         Re-entering Auto from those events flipped density bands endlessly. */
      if (source === 'resize' && performance.now() < zoomSettleUntil.current) return;
      const preferences = readSettingsValues(PERSONAL_SETTINGS_KEY);
      const interfaceChoice = readInterfaceScaleChoice(preferences['appearance.interface-size']);
      /* Fixed sizes ignore window resize. Auto must not use zoomed innerWidth. */
      if (source === 'resize' && interfaceChoice !== 'auto') return;
      const { width, height } = layoutViewportSize(window);
      /* Ignore zoom/glass settle noise that did not actually change the outer frame.
         That was the Mac “3–4 scales jiggling” loop with Auto + setZoom. */
      if (source === 'resize' && interfaceChoice === 'auto' && lastAutoOuter.current) {
        const dw = Math.abs(lastAutoOuter.current.width - width);
        const dh = Math.abs(lastAutoOuter.current.height - height);
        if (dw < 24 && dh < 24) return;
      }
      const interfaceSize = resolveInterfaceScale(preferences['appearance.interface-size'], width, height, resolvedInterfaceBand.current ?? undefined);
      const documentSize = readDocumentScaleChoice(preferences['appearance.document-size']);
      const nextScale = INTERFACE_SCALE_VALUES[interfaceSize];
      resolvedInterfaceBand.current = interfaceSize;
      lastAutoOuter.current = { width, height };
      /* CSS vars stay for readers; applyNativeInterfaceZoom chooses native vs CSS zoom. */
      document.documentElement.style.setProperty('--interface-scale', nextScale);
      document.documentElement.style.setProperty('--document-scale', DOCUMENT_SCALE_VALUES[documentSize]);
      /* Only reassert zoom when the density band changes, so Ctrl +/- is not
         wiped by ordinary resize events. Startup and Settings still restore the choice. */
      if (appliedInterfaceZoom.current === nextScale) return;
      appliedInterfaceZoom.current = nextScale;
      zoomSettleUntil.current = performance.now() + 1200;
      if (zoomApplyTimer.current) window.clearTimeout(zoomApplyTimer.current);
      /* Debounce Settings slider steps. Never remount GlassScene on scale change —
         that destroyed Settings mid-drag on Windows and looked like an endless
         up/down zoom loop. Desktop uses webview setZoom; bun run dev uses CSS zoom. */
      const delay = source === 'prefs' ? 180 : 0;
      const zoomFactor = Number(nextScale);
      zoomApplyTimer.current = window.setTimeout(() => {
        zoomApplyTimer.current = null;
        void applyNativeInterfaceZoom(zoomFactor).finally(() => {
          /* Desktop only: let glass remeasure after native zoom. Skip faked resize
             in the browser — CSS zoom already updates layout and a synthetic
             resize re-enters Auto density. Mark settle again so the glass
             resize cannot flip Auto bands. */
          if (Boolean(window.airDesktop)) {
            zoomSettleUntil.current = performance.now() + 1200;
            window.setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
          }
        });
      }, delay);
    };
    applyDisplayScale('startup');
    const onPrefs = () => {
      lastAutoOuter.current = null;
      applyDisplayScale('prefs');
    };
    const onResize = () => applyDisplayScale('resize');
    window.addEventListener('office-display-scale-changed', onPrefs);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('office-display-scale-changed', onPrefs);
      window.removeEventListener('resize', onResize);
      if (zoomApplyTimer.current) window.clearTimeout(zoomApplyTimer.current);
    };
  }, []);
  const dialogs = useAppDialogs();
  const adapter = useMemo(() => new BrowserFileAdapter(), []);
  const providerCatalog = useProviderCatalog();
  /** Sync catalog + chat settings for send/reload in the same turn as a model change (React state lags). */
  const catalogSelectionRef = useRef<{ provider: string | null; model: string | null }>({ provider: null, model: null });
  const chatSettingsRef = useRef<ChatComposerSettings>({});
  catalogSelectionRef.current = { provider: providerCatalog.selectedProvider, model: providerCatalog.selectedModel };
  const modelVisibility = useModelVisibility();
  const [appsFocus, setAppsFocus] = useState<{ appId?: string; requestId: number }>({ requestId: 0 });
  const knowledge = useKnowledgeWorkspace();
  const methods = useMethodsWorkspace();
  const serviceClient = useMemo(() => createServiceClient(), []);
  /** The local models the runtime holds, so a chat reply can be read aloud. */
  const localModels = useInstalledLocalModels(serviceClient);
  const explorerFiles = useMemo(() => createExplorerFileClient(serviceClient), [serviceClient]);
  const explorerControls = useRef<ProgramExplorerControls | null>(null);
  const [connectedRoots, setConnectedRoots] = useState<ConnectedRoot[]>([]);
  const [codeFolder, setCodeFolder] = useState<string | null>(null);
  const [codeReveal, setCodeReveal] = useState<CodeRevealRequest | null>(null);
  useEffect(() => { void serviceClient.json<{ roots: ConnectedRoot[] }>('/api/v1/external/roots').then(({ roots }) => setConnectedRoots(roots)).catch(() => undefined); }, [serviceClient]);
  const abortRef = useRef<AbortController | null>(null);
  const [files, setFiles] = useState<FileSnapshot[]>([]);
  const [stage, setStage] = useState<StageState>(restoreStage);
  const [programScopeId, setProgramScopeId] = useState<string | undefined>();
  const [programSection, setProgramSection] = useState<'files' | 'instructions'>('files');
  const [programVisit, setProgramVisit] = useState(0);
  const researchScopeKey = `office.research-scope:${localStorage.getItem('office.development.demo') === 'on' ? 'demo' : 'personal'}`;
  const [researchScopeId, setResearchScopeId] = useState<string | undefined>(() => localStorage.getItem(researchScopeKey) || undefined);
  useEffect(() => {
    if (researchScopeId) localStorage.setItem(researchScopeKey, researchScopeId);
    else localStorage.removeItem(researchScopeKey);
  }, [researchScopeId, researchScopeKey]);
  const [projectReview, setProjectReview] = useState<ProjectReview | undefined>();
  const stageRef = useRef(stage);
  const [navigation, setNavigation] = useState<WorkspaceNavigation>(() => ({ back: [], current: stage.activeId, forward: [] }));
  const navigationRef = useRef(navigation);
  const stageScrollPositions = useRef(new Map<string | null, number>());
  useLayoutEffect(() => {
    const scroller = document.getElementById('stage-panel');
    if (!scroller) return;
    scroller.scrollTop = stageScrollPositions.current.get(stage.activeId) ?? 0;
    const remember = () => stageScrollPositions.current.set(stage.activeId, scroller.scrollTop);
    scroller.addEventListener('scroll', remember, { passive: true });
    return () => scroller.removeEventListener('scroll', remember);
  }, [stage.activeId]);
  const [buffers, setBuffers] = useState<Record<string, DocumentBuffer>>({});
  const [richBuffers, setRichBuffers] = useState<Record<string, RichDocument>>({});
  const richBuffersRef = useRef(richBuffers);
  const [richSourceMode, setRichSourceMode] = useState(false);
  const [projectionConflictOpen, setProjectionConflictOpen] = useState(false);
  const [agentKnowledgePreview, setAgentKnowledgePreview] = useState('');
  const [agentKnowledgeSources, setAgentKnowledgeSources] = useState<typeof knowledge.results>([]);
  const [promptValues, setPromptValues] = useState<Record<string, Record<string, string>>>({});
  const [attachedMethodIds, setAttachedMethodIds] = useState<string[]>(() => { try { const stored: unknown = JSON.parse(localStorage.getItem('air-office:attached-methods') ?? '[]'); return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []; } catch { return []; } });
  const buffersRef = useRef(buffers);
  const scopeEpoch = useRef(0);
  const contextEpoch = useRef(0);
  const loading = useRef(new Map<string, Promise<void>>());
  /** File ids whose buffer is still being fetched — keeps the empty editor from mounting first. */
  const [openingFileIds, setOpeningFileIds] = useState<ReadonlySet<string>>(() => new Set());
  const [ready, setReady] = useState(false);
  const activeStageTabId = stage.activeId;
  const stageTabs = stage.surfaces;
  const buffer = activeStageTabId ? buffers[activeStageTabId] : undefined;
  const active = buffer?.file ?? null;
  const content = buffer?.content ?? '';
  const [fileRichEdits, setFileRichEdits] = useState<Record<string, FileRichEdit>>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem('air-office:markdown-rich-edits') ?? '{}');
      if (!value || typeof value !== 'object') return {};
      return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry && typeof entry === 'object' && typeof entry.source === 'string' && validateRichDocument(entry.document)));
    } catch { return {}; }
  });
  const previousFileRichDocuments = useRef(new Map<string, RichDocument>());
  /* Markdown files stay markdown on disk. Lobe opens them with type=markdown; the
     envelope here is only identity/attachments until onTextChange fills the body.
     Do not headless-convert on open — that blocked the UI and duplicated Lobe's own hydrate. */
  const fileRichDocument = useMemo(() => {
    if (!active || !isMarkdownFile(active.name)) return null;
    const edit = fileRichEdits[active.id];
    if (edit?.source === content) return edit.document;
    const previous = previousFileRichDocuments.current.get(active.id);
    const title = active.name.replace(/\.(md|markdown|mdown|mkd)$/i, '');
    return {
      ...(previous && previous.id === active.id ? previous : createRichDocument(title, active.id)),
      title,
      body: emptyNativeBody(),
      updatedAt: new Date().toISOString()
    } satisfies RichDocument;
  }, [active?.id, active?.name, content, fileRichEdits]);
  if (fileRichDocument && active) previousFileRichDocuments.current.set(active.id, fileRichDocument);
  const [resetRevision, setResetRevision] = useState(0);
  const [fileConflict, setFileConflict] = useState<string | null>(null);
  const authorized = connectedRoots.length > 0;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), noticeDurationMs());
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (error) {
      toast(error, { variant: 'danger', timeout: noticeDurationMs(), onClose: () => setError('') });
    } else if (notice) {
      toast(notice, { variant: 'default', timeout: noticeDurationMs(), onClose: () => setNotice('') });
    }
  }, [error, notice]);
  const [documentSending, setDocumentSending] = useState(false);
  const [selection, setSelection] = useState('');
  const [proposal, setProposal] = useState<DocumentAIProposal | null>(null);
  const activeEditorRef = useRef<NonNullable<LobeDocumentEditorProps['editorRef']>['current']>(null);
  const [fileSourceMode, setFileSourceMode] = useState<Record<string, boolean>>({});
  // The knowledge attached to the next message. It is a selection of
  // collections and documents, and the service decides what to retrieve
  // from them when the message is sent.
  const [contextSelection, setContextSelection] = useState<ComposerContextSelection>(EMPTY_CONTEXT_SELECTION);
  // What the last search of the attached context produced. It is kept so the
  // composer can show the snippets that travelled with the message, and so an
  // empty result is visible instead of silent.
  const [contextOutcome, setContextOutcome] = useState<ContextRetrievalOutcome>({ kind: 'not-attached' });
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && isCompactViewport());
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(() => typeof window !== 'undefined' ? restoreThemeChoice() : 'system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => typeof window !== 'undefined' ? resolveTheme(restoreThemeChoice()) : 'light');
  const [viewportWidth, setViewportWidth] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1280);
  const [filesOpen, setFilesOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return restorePanelPreferences(window.innerWidth, isCompactViewport(), {
      filesOpen: localStorage.getItem('air-office:files-open') !== '0',
      chatOpen: localStorage.getItem('air-office:chat-open') !== '0'
    }).files;
  });
  const [chatOpen, setChatOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return restorePanelPreferences(window.innerWidth, isCompactViewport(), {
      filesOpen: localStorage.getItem('air-office:files-open') !== '0',
      chatOpen: localStorage.getItem('air-office:chat-open') !== '0'
    }).chat;
  });
  const expandedStagePanels = useRef<{ files: boolean; chat: boolean } | null>(null);
  const stageExpanded = !filesOpen && !chatOpen;
  function toggleStageExpanded() {
    if (stageExpanded) {
      const previous = expandedStagePanels.current ?? { files: true, chat: !isCompactViewport() && window.innerWidth >= ALL_PANELS_MIN };
      setFilesOpen(previous.files);
      setChatOpen(previous.chat);
      expandedStagePanels.current = null;
    } else {
      expandedStagePanels.current = { files: filesOpen, chat: chatOpen };
      setFilesOpen(false);
      setChatOpen(false);
    }
  }
  const [leftShare, setLeftShare] = useState(() => readRailShare('air-office:left-width', typeof window !== 'undefined' ? window.innerWidth : 1280));
  const [rightShare, setRightShare] = useState(() => readRailShare('air-office:right-width', typeof window !== 'undefined' ? window.innerWidth : 1280));
  const dragRef = useRef<null | { side: 'left' | 'right'; startX: number; startWidth: number; minWidth: number; maxWidth: number }>(null);
  const stageElementRef = useRef<HTMLDivElement | null>(null);
  const chatDockHost = useRef<HTMLDivElement | null>(null);
  const [chatHeaderHost, setChatHeaderHost] = useState<HTMLDivElement | null>(null);
  const [libraryHeaderHost, setLibraryHeaderHost] = useState<HTMLDivElement | null>(null);
  const dirty = buffer ? isDocumentDirty(buffer) || Boolean(fileRichEdits[buffer.file.id] && !fileRichEdits[buffer.file.id]?.saved) : false;
  const richDocumentActive = Boolean(activeStageTabId && stageTabs.find((tab) => tab.id === activeStageTabId)?.kind === 'rich-document');
  const activeRichDocument = richDocumentActive && activeStageTabId
    ? (richBuffers[activeStageTabId] ?? Object.values(richBuffers).find((note) => note.path === activeStageTabId || note.id === activeStageTabId))
    : undefined;
  const richDirty = Boolean(activeRichDocument && localStorage.getItem(`${draftKey(activeRichDocument.id)}:rich`) !== null);
  const activeVaultNoteId = richDocumentActive && activeStageTabId ? activeStageTabId : null;
  const noteProjection = useNoteProjectionDrift(serviceClient, activeVaultNoteId);
  useEffect(() => {
    if (!activeVaultNoteId) {
      setProjectionConflictOpen(false);
      return;
    }
    void noteProjection.refresh().then((state) => {
      if (state && state.kind !== 'ok') setProjectionConflictOpen(true);
      else setProjectionConflictOpen(false);
    });
  }, [activeVaultNoteId, richSourceMode]);
  const canResize = !compact;
  const leftWidth = preferredRailWidth(leftShare, viewportWidth, LEFT_MIN, LEFT_MAX);
  const rightWidth = preferredRailWidth(rightShare, viewportWidth, RIGHT_MIN, RIGHT_MAX);
  const fitted = fitRailWidths(viewportWidth, leftWidth, rightWidth, filesOpen, chatOpen);
  const leftSize = fitted.left;
  const rightSize = fitted.right;
  const stageBudget = Math.max(0, viewportWidth - SHELL_CHROME - (filesOpen ? leftSize : 0) - (chatOpen ? rightSize : 0));
  const titlebarSafe = stageBudget <= TITLEBAR_SAFE_STAGE_MAX && (!filesOpen || !chatOpen);

  function resizeRailWithKey(side: 'left' | 'right', event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const limits = railLimitsFor(viewportWidth, side);
    const current = side === 'left' ? leftSize : rightSize;
    const other = side === 'left' ? rightSize : leftSize;
    const direction = (event.key === 'ArrowRight' ? 1 : -1) * (side === 'left' ? 1 : -1);
    const maximum = Math.min(limits.max, viewportWidth - SHELL_CHROME - STAGE_MIN - other);
    const next = clamp(current + direction * 16, limits.min, maximum);
    const share = persistRailShare(side, next, viewportWidth);
    if (side === 'left') setLeftShare(share);
    else setRightShare(share);
  }

  function saveRichBuffers(next: Record<string, RichDocument>) {
    richBuffersRef.current = next;
    setRichBuffers(next);
  }
  /** Stage tabs may use a vault path as the surface id while buffers stay keyed by note UUID. */
  function richBufferFor(id: string | null | undefined, source: Record<string, RichDocument> = richBuffersRef.current): RichDocument | undefined {
    if (!id) return undefined;
    return source[id] ?? Object.values(source).find((note) => note.path === id || note.id === id);
  }
  function protectRichDraft(document: RichDocument) {
    try { localStorage.setItem(`${draftKey(document.id)}:rich`, JSON.stringify(document)); }
    catch { setError('Could not save this draft locally. Your changes are still open.'); }
    saveRichBuffers({ ...richBuffersRef.current, [document.id]: document });
  }
  function updateRichContent(id: string, body: unknown) {
    const current = richBufferFor(id);
    if (!current) return;
    contextEpoch.current += 1;
    const updated: RichDocument = { ...current, body, updatedAt: new Date().toISOString() };
    if (!validateRichDocument(updated)) { setError('The edited content does not match the supported document format.'); return; }
    protectRichDraft(updated);
  }
  async function updateRichSource(id: string, markdown: string) {
    const current = richBufferFor(id);
    if (!current) return;
    try {
      localStorage.setItem(`${draftKey(current.id)}:rich-before-source-edit`, JSON.stringify(current));
      localStorage.setItem(`${draftKey(current.id)}:source`, markdown);
    }
    catch { setError('Could not save the source changes locally.'); return; }
    updateRichContent(id, markdownToNativeBody(markdown));
    setNotice('Document updated.');
  }
  async function openRichNote(document: RichDocument | unknown) {
    let preferred: unknown = document;
    try {
      const recovered: unknown = JSON.parse(localStorage.getItem(`${draftKey((document as RichDocument).id)}:rich`) ?? 'null');
      if (validateRichDocument(recovered) && validateRichDocument(document) && recovered.updatedAt > document.updatedAt) preferred = recovered;
      else if (validateRichDocument(recovered) && !validateRichDocument(document)) preferred = recovered;
    } catch { setError('Could not read the saved draft.'); }
    const canonical = await ensureNativeRichDocument(preferred);
    if (!canonical) { setError('This note could not be opened in the supported document format.'); return; }
    const surfaceId = canonical.path ?? canonical.id;
    saveRichBuffers({ ...richBuffersRef.current, [canonical.id]: canonical });
    updateStage(openStageSurface(stageRef.current, { id: surfaceId, kind: 'rich-document', title: canonical.title, fileId: surfaceId }));
  }
  async function createRichNote(requestedTitle?: string) {
    const title = requestedTitle ?? (await dialogs.prompt({ title: 'New note', label: 'Title', initialValue: 'Untitled note', submitLabel: 'Create' }))?.trim();
    if (!title) return;
    const document = createRichDocument(title);
    const { document: stored } = await serviceClient.json<{ document: RichDocument }>('/api/v1/rich-documents', { method: 'POST', body: JSON.stringify(document) });
    openRichNote(stored);
    return stored;
  }
  function openPrograms(scopeId?: string, section: 'files' | 'instructions' = 'files') {
    showFiles();
    setProgramSection(section);
    setProgramVisit((visit) => visit + 1);
    setProgramScopeId(scopeId);
    openWorkspaceSurface('programs');
  }
  async function refreshPrograms() {
    await explorerControls.current?.refresh();
    await chat.refresh();
    window.dispatchEvent(new Event('office-workspace-changed'));
  }
  async function createProgramNote(parentId: string) {
    const title = (await dialogs.prompt({ title: 'New note', label: 'Title', initialValue: 'Untitled note', submitLabel: 'Create' }))?.trim();
    if (!title) return;
    const { document } = await serviceClient.json<{ document: RichDocument }>('/api/v1/rich-documents', { method: 'POST', body: JSON.stringify(createRichDocument(title)) });
    await serviceClient.json('/api/v1/workspace/nodes', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), kind: 'note', parentId, name: title, targetId: document.path ?? document.id }) });
    await refreshPrograms();
    openRichNote(document);
  }
  async function openNoteById(id: string) {
    try {
      const note = richBufferFor(id) ?? (await serviceClient.json<{ document: RichDocument }>(`/api/v1/rich-documents/${encodeURIComponent(id)}`)).document;
      await openRichNote(note);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The document could not be opened.'); }
  }
  async function resumeProjectChat(parentId: string) {
    const previous = chat.summaries.filter(item => item.folderId === parentId && !item.archivedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (previous) { showChat(previous.id); return; }
    await startProgramChat(parentId);
  }
  async function startProgramChat(parentId: string) {
    const id = await chat.createConversation();
    await conversationClient.update(id, { folderId: parentId });
    await chat.refresh();
    setRightMode('chat');
    if (!chatOpen) toggleChat();
  }
  async function createPreparedNote(title: string, markdown: string) {
    const document: RichDocument = { ...createRichDocument(title), body: markdownToNativeBody(markdown) };
    const { document: stored } = await serviceClient.json<{ document: RichDocument }>('/api/v1/rich-documents', { method: 'POST', body: JSON.stringify(document) });
    return stored;
  }
  async function filePreparedNote(stored: RichDocument, parentId: string) {
    try {
      await filePreparedNoteInWorkspace(serviceClient, stored, parentId);
      await refreshPrograms();
    } catch (reason) {
      openRichNote(stored);
      showFiles();
      const detail = reason instanceof Error ? ` ${reason.message}` : '';
      throw new Error(`The note was saved in Library, but Office could not file it in the prepared Program.${detail}`, { cause: reason });
    }
    showFiles();
    openRichNote(stored);
  }
  async function createFellowshipWorkspace(plan: FellowshipPlan) {
    const createdAt = new Date();
    const project = await prepareResearchProject(serviceClient, plan);
    const parentId = project.id;
    setResearchScopeId(parentId);
    const stored = await createPreparedNote(fellowshipResearchTitle(plan, createdAt), fellowshipResearchMarkdown(plan));
    await filePreparedNote(stored, parentId);
    setNotice('Fellowship workspace created.');
    await serviceClient.json(`/api/v1/workspace/scopes/${encodeURIComponent(parentId)}/knowledge`, { method: 'POST' });
    return parentId;
  }
  async function createCraftSubmissionDraft(parentId?: string) {
    if (!parentId) throw new Error('Choose the project whose contribution you want to share.');
    const { nodes } = await serviceClient.json<{ nodes: WorkspaceNode[] }>('/api/v1/workspace/nodes');
    const project = nodes.find((node) => node.id === parentId && node.kind === 'project');
    if (!project) throw new Error('Choose a project for this submission record.');
    setResearchScopeId(parentId);
    const previous = nodes.find((node) => node.kind === 'note' && node.parentId === parentId && node.name.startsWith('AIR-Craft submission record'));
    if (previous?.kind === 'note') {
      setNotice('');
      const local = richBufferFor(previous.targetId);
      const stored = local ?? (await serviceClient.json<{ document: RichDocument }>(`/api/v1/rich-documents/${encodeURIComponent(previous.targetId)}`)).document;
      showFiles(); openRichNote(stored);
      return;
    }
    const createdAt = new Date();
    const stored = await createPreparedNote(craftSubmissionTitle(createdAt), craftSubmissionMarkdown(project.name));
    await filePreparedNote(stored, parentId);
    setNotice('AIR-Craft submission record created.');
    await serviceClient.json(`/api/v1/workspace/scopes/${encodeURIComponent(parentId)}/knowledge`, { method: 'POST' });
  }
  async function renameRichNote(id: string, title: string) {
    const current = richBufferFor(id);
    if (!current) throw new Error('This note is unavailable.');
    const updated = { ...current, title, updatedAt: new Date().toISOString() };
    protectRichDraft(updated);
    await serviceClient.json('/api/v1/rich-documents', { method: 'POST', body: JSON.stringify(updated) });
    const surfaceId = current.path ?? current.id;
    updateStage({ ...stageRef.current, surfaces: stageRef.current.surfaces.map((surface) => surface.id === id || surface.id === surfaceId || surface.id === current.id ? { ...surface, title } : surface) });
  }
  async function cloneRichNote(id: string) {
    const current = richBufferFor(id);
    if (!current) throw new Error('This note is unavailable.');
    const document = { ...current, id: crypto.randomUUID(), path: undefined, title: `${current.title} copy`, updatedAt: new Date().toISOString() };
    const { document: stored } = await serviceClient.json<{ document: RichDocument }>('/api/v1/rich-documents', { method: 'POST', body: JSON.stringify(document) });
    saveRichBuffers({ ...richBuffersRef.current, [stored.id]: stored });
    return stored;
  }
  async function trashRichNote(id: string) {
    const current = richBufferFor(id);
    if (current && localStorage.getItem(`${draftKey(current.id)}:rich`)) protectRichDraft(current);
    const handle = current?.path ?? id;
    await serviceClient.json(`/api/v1/rich-documents/${encodeURIComponent(handle)}`, { method: 'DELETE' });
    if (current) {
      const next = { ...richBuffersRef.current };
      delete next[current.id];
      saveRichBuffers(next);
      updateStage(closeStageSurface(stageRef.current, current.path ?? current.id));
    } else {
      updateStage(closeStageSurface(stageRef.current, id));
    }
  }
  async function restoreRichNote(id: string) {
    const { document } = await serviceClient.json<{ document: RichDocument }>(`/api/v1/rich-documents/${encodeURIComponent(id)}/restore`, { method: 'POST' });
    saveRichBuffers({ ...richBuffersRef.current, [document.id]: document });
    openRichNote(document);
  }
  async function saveRichNote(id: string, options?: { resolveDualDirty?: boolean }) {
    const document = richBufferFor(id);
    if (!document || !validateRichDocument(document)) { setError('This rich document does not match the supported format.'); return false; }
    if (!options?.resolveDualDirty) {
      const drift = await noteProjection.refresh();
      const dirty = localStorage.getItem(`${draftKey(document.id)}:rich`) !== null;
      if (dirty && drift?.kind === 'markdown-drift') {
        setProjectionConflictOpen(true);
        setError('This note’s editor and Markdown both changed. Choose Keep editor or Keep markdown before saving.');
        return false;
      }
    }
    try {
      const stored = await serviceClient.json<{ document: RichDocument }>('/api/v1/rich-documents', { method: 'POST', body: JSON.stringify(document) });
      if (richBuffersRef.current[document.id] === document) {
        saveRichBuffers({ ...richBuffersRef.current, [document.id]: stored.document });
        localStorage.removeItem(`${draftKey(document.id)}:rich`);
        setNotice('Rich note saved.');
        await noteProjection.refresh().then((state) => setProjectionConflictOpen(Boolean(state && state.kind !== 'ok')));
      } else setNotice('Saved the submitted version. Newer edits remain in the draft.');
      return true;
    } catch (reason) {
      protectRichDraft(document);
      const message = reason instanceof Error ? reason.message : '';
      setError(/409|changed externally|reopen it before trying again/i.test(message)
        ? 'This note changed outside AIR Office. Your draft is preserved here; reopen the note to review the canonical version before saving again.'
        : 'Could not save this note. Your unsaved changes remain in this browser until the service is available.');
      return false;
    }
  }

  async function keepEditorProjection(id: string) {
    const current = richBufferFor(id);
    const saved = await saveRichNote(id, { resolveDualDirty: true });
    if (!saved || !current) return;
    const discarded = await noteProjection.discard();
    if (discarded && validateRichDocument(discarded)) saveRichBuffers({ ...richBuffersRef.current, [current.id]: discarded as RichDocument });
    setProjectionConflictOpen(false);
    setError('');
  }

  async function keepMarkdownProjection(id: string) {
    const current = richBufferFor(id);
    const applied = await noteProjection.apply();
    if (!applied || !validateRichDocument(applied.document) || !current) return;
    saveRichBuffers({ ...richBuffersRef.current, [current.id]: applied.document as RichDocument });
    localStorage.removeItem(`${draftKey(current.id)}:rich`);
    setProjectionConflictOpen(false);
    setError('');
    setNotice(applied.warnings?.length ? applied.warnings.join(' ') : 'Markdown applied onto the note.');
  }
  useEffect(() => {
    const epoch = scopeEpoch.current;
    void Promise.all([serviceClient.json<{ documents: unknown[] }>('/api/v1/rich-documents'), serviceClient.json<{ documents: { id: string }[] }>('/api/v1/rich-documents/trash')]).then(async ([{ documents }, { documents: trashed }]) => {
      if (epoch !== scopeEpoch.current) return;
      const next = Object.fromEntries(Object.entries(richBuffersRef.current).filter(([id]) => !trashed.some((item) => item.id === id)));
      for (const candidate of documents) {
        const native = await ensureNativeRichDocument(candidate);
        if (!native) continue;
        let draft: RichDocument | null = null;
        try { const parsed: unknown = JSON.parse(localStorage.getItem(`${draftKey(native.id)}:rich`) ?? 'null'); if (validateRichDocument(parsed)) draft = parsed; } catch { /* Keep malformed recovery data untouched. */ }
        if (draft && draft.updatedAt > native.updatedAt) next[native.id] = draft;
        else next[native.id] = native;
      }
      if (epoch !== scopeEpoch.current) return;
      saveRichBuffers(next);
    }).catch(() => undefined);
  }, [serviceClient]);
  function preserveMarkdownSource(current: DocumentBuffer): boolean {
    try {
      const key = `${draftKey(current.file.id)}:original-source`;
      if (localStorage.getItem(key) === null) localStorage.setItem(key, current.content);
      localStorage.setItem(`${draftKey(current.file.id)}:source`, current.content);
      return true;
    } catch {
      setError('Could not save the source locally. Your document is still open.');
      return false;
    }
  }
  function toggleFileSourceMode(id: string) {
    const current = buffersRef.current[id];
    if (!current) return;
    contextEpoch.current += 1;
    setSelection(''); setProposal(null);
    setFileSourceMode((previous) => ({ ...previous, [id]: !(previous[id] ?? false) }));
  }
  function updateFileRichContent(id: string, body: unknown, markdown?: string) {
    const current = buffersRef.current[id];
    if (!current || stageRef.current.activeId !== id || !ready) return;
    const title = current.file.name.replace(/\.(md|markdown|mdown|mkd)$/i, '');
    const imported = previousFileRichDocuments.current.get(id) ?? { ...createRichDocument(title, id), body: emptyNativeBody() };
    const next: RichDocument = { ...imported, title, body, updatedAt: new Date().toISOString() };
    if (!validateRichDocument(next)) { setError('Could not apply this edit.'); return; }
    if (!preserveMarkdownSource(current)) return;
    /* Prefer Lobe's own markdown export from the live editor. Headless
       documentMarkdown() is exchange-only and must not run on every text change. */
    const exported = typeof markdown === 'string' ? markdown : documentMarkdown(next);
    const edits = { ...fileRichEdits, [id]: { source: exported, document: next } };
    try { localStorage.setItem('air-office:markdown-rich-edits', JSON.stringify(edits)); }
    catch { setError('Could not save this edit locally. Your document is still open.'); }
    setFileRichEdits(edits);
    previousFileRichDocuments.current.set(id, next);
    if (exported !== current.content) setContent(exported);
  }
  function exportNote(id: string, format: 'markdown' | 'html') {
    const fileBuffer = buffersRef.current[id];
    const richDocument = fileBuffer && isMarkdownFile(fileBuffer.file.name)
      ? fileRichEdits[id]?.source === fileBuffer.content && fileRichEdits[id]
        ? fileRichEdits[id]!.document
        : { ...createRichDocument(fileBuffer.file.name.replace(/\.(md|markdown|mdown|mkd)$/i, ''), id), body: markdownToNativeBody(fileBuffer.content) }
      : richBufferFor(id);
    if (!richDocument) return;
    const result = fileBuffer && format === 'markdown'
      ? { content: fileBuffer.content, report: { fidelity: 'lossless' as const, warnings: [] as string[] } }
      : exportRichDocument(richDocument, format);
    const blob = new Blob([result.content], { type: format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/html;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${richDocument.title}.${format === 'markdown' ? 'md' : 'html'}`; link.click(); URL.revokeObjectURL(link.href);
    setNotice(`${format === 'markdown' ? 'Markdown' : 'HTML'} exported.`);
  }
  async function attachToRichDocument(id: string, file: File, insert = true) {
    if (buffersRef.current[id]) {
      const current = previousFileRichDocuments.current.get(id);
      if (!current) return;
      if (file.size > 2_000_000) { setError('Attachments must be 2 MB or smaller.'); return; }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read attachment.')); reader.onerror = () => reject(new Error('Could not read attachment.')); reader.readAsDataURL(file); });
        const attachment = { id: crypto.randomUUID(), name: file.name, mediaType: file.type || 'application/octet-stream', size: file.size, dataUrl };
        if (insert) {
          const buffer = buffersRef.current[id];
          if (!buffer || !preserveMarkdownSource(buffer)) return;
          const next = { ...current, attachments: [...current.attachments, attachment], updatedAt: new Date().toISOString() };
          if (!validateRichDocument(next)) { setError('Could not add this attachment.'); return; }
          previousFileRichDocuments.current.set(id, next);
          const edits = { ...fileRichEdits, [id]: { source: buffer.content, document: next } };
          try { localStorage.setItem('air-office:markdown-rich-edits', JSON.stringify(edits)); } catch { setError('Could not save this attachment locally. Your document is still open.'); }
          setFileRichEdits(edits);
        }
        return attachment;
      } catch { setError('Could not add this attachment.'); }
      return;
    }
    if (file.size > 2_000_000) { setError('Attachments must be 2 MB or smaller.'); return; }
    let dataUrl: string;
    try {
      dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read attachment.')); reader.onerror = () => reject(new Error('Could not read attachment.')); reader.readAsDataURL(file); });
    } catch { setError('The attachment could not be read. The document is unchanged.'); return; }
    const current = richBufferFor(id); if (!current) return;
    const attachment = { id: crypto.randomUUID(), name: file.name, mediaType: file.type || 'application/octet-stream', size: file.size, dataUrl };
    const attachments = [...current.attachments, attachment];
    const next = { ...current, attachments, updatedAt: new Date().toISOString() };
    if (!validateRichDocument(next)) { setError('This attachment does not match the supported portable format.'); return; }
    protectRichDraft(next);
    return attachment;
  }
  function toggleAttachedMethod(id: string) {
    setAgentKnowledgePreview('');
    const attaching = !attachedMethodIds.includes(id);
    const selected = methods.definitions.find((definition) => definition.value.id === id);
    const retained = attaching && selected?.kind === 'preset'
      ? attachedMethodIds.filter((current) => methods.definitions.find((definition) => definition.value.id === current)?.kind !== 'preset')
      : attachedMethodIds;
    let next = attaching ? [...retained, id] : retained.filter((current) => current !== id);
    if (attaching && selected?.kind === 'preset') {
      for (const skillId of selected.value.skillIds) {
        if (!next.includes(skillId) && methods.definitions.some((definition) => definition.value.id === skillId && definition.kind === 'skill')) next = [...next, skillId];
      }
    }
    localStorage.setItem('air-office:attached-methods', JSON.stringify(next));
    setAttachedMethodIds(next);
  }
  const [marketCategory, setMarketCategory] = useState('all');
  const [marketFocus, setMarketFocus] = useState<{ id: number; category: 'skill' | 'mcp'; query?: string; group?: 'News & research' | 'Government & money' }>();
  function openModelMarket() { setMarketCategory('models'); openWorkspaceSurface('market'); }
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('dashboard');
  const [settingsAction, setSettingsAction] = useState<'create' | undefined>(undefined);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | undefined>();
  const settingsReturnId = useRef<string | null>(null);
  const [welcomeSelected, setWelcomeSelected] = useState(() => pathname === '/' || stage.activeId === null);
  const previousPathname = useRef(pathname);
  function updateStage(next: StageState, traversed?: WorkspaceNavigation, preserveWelcome = false) {
    const history = traversed ?? visitWorkspace(navigationRef.current, next);
    navigationRef.current = history;
    setNavigation(history);
    if (next.activeId === null) setWelcomeSelected(true);
    else if (!preserveWelcome) setWelcomeSelected(false);
    if (next.activeId !== stageRef.current.activeId) { contextEpoch.current += 1; setSelection(''); setProposal(null); }
    stageRef.current = next;
    setStage(next);
    localStorage.setItem(stageStateKey, JSON.stringify(next));
  }
  /** Select Welcome as the current stage (`activeId: null`). Open tabs stay listed. */
  function selectWelcome() {
    navigate('/');
    updateStage(withWelcomeSelected(stageRef.current));
    setSelection('');
    setProposal(null);
    contextEpoch.current += 1;
  }
  function openWorkspaceSurface(id: WorkspaceSurfaceId, date?: string) {
    if (id === 'calendar') setSelectedCalendarDate(date);
    navigate(workspacePath(id, date));
    updateStage(openStageSurface(stageRef.current, workspaceSurfaces[id]));
  }
  function focusAppsWorkspace(appId?: string) {
    setAppsFocus((current) => ({ appId, requestId: current.requestId + 1 }));
    openWorkspaceSurface('apps');
  }
  useEffect(() => {
    const route = parseWorkspaceRoute(pathname, search);
    const previousPath = previousPathname.current;
    previousPathname.current = pathname;
    if (route.kind === 'welcome') {
      // Closing a chat URL resolves to `/`; keep the focused stage surface in that case.
      if (previousPath.startsWith('/chat/') && stageRef.current.activeId !== null) return;
      if (stageRef.current.activeId !== null) updateStage(withWelcomeSelected(stageRef.current));
      else setWelcomeSelected(true);
      return;
    }
    if (route.kind === 'chat') return;
    if (route.kind === 'settings') {
        setSettingsSection(route.section);
      setSettingsAction(route.action);
      const withoutMethods = stageRef.current.surfaces.some((surface) => surface.id === 'methods')
        ? closeStageSurface(stageRef.current, 'methods')
        : stageRef.current;
      updateStage(openStageSurface(withoutMethods, { id: 'settings', kind: 'settings', title: 'Settings' }));
      return;
    }
    if (route.id === 'calendar') setSelectedCalendarDate(route.date);
    updateStage(openStageSurface(stageRef.current, workspaceSurfaces[route.id]));
  }, [pathname, search]);
  function closeWorkspaceView(id: string) {
    updateStage(closeVisitedWorkspace(stageRef.current, navigationRef.current, id));
  }
  function navigateWorkspace(direction: 'back' | 'forward') {
    const history = traverseWorkspace(navigationRef.current, direction);
    if (history === navigationRef.current) return;
    updateStage({ ...stageRef.current, activeId: history.current }, history);
  }
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      navigateWorkspace(event.key === 'ArrowLeft' ? 'back' : 'forward');
    };
    window.addEventListener('keydown', navigate);
    return () => window.removeEventListener('keydown', navigate);
  }, []);
  function openSettingsWorkspace(section: SettingsSection = 'dashboard', action?: 'create') {
    setSettingsAction(action);
    if (stageRef.current.activeId !== 'settings' && stageRef.current.activeId !== 'methods') settingsReturnId.current = stageRef.current.activeId;
    setSettingsSection(section);
    navigate(settingsPath(section, action));
    const withoutMethods = stageRef.current.surfaces.some((surface) => surface.id === 'methods')
      ? closeStageSurface(stageRef.current, 'methods')
      : stageRef.current;
    updateStage(openStageSurface(withoutMethods, { id: 'settings', kind: 'settings', title: 'Settings' }));
  }
  function closeSettingsWorkspace() {
    const next = closeStageSurface(closeStageSurface(stageRef.current, 'methods'), 'settings');
    const previous = next.surfaces.find((surface) => surface.id === settingsReturnId.current);
    updateStage(previous ? { ...next, activeId: previous.id } : closeVisitedWorkspace(stageRef.current, navigationRef.current, 'settings'));
    if (previous && isWorkspaceSurfaceId(previous.id)) navigate(workspacePath(previous.id));
    else navigate('/');
    settingsReturnId.current = null;
  }
  useEffect(() => {
    if (stageRef.current.activeId !== 'methods') return;
    setSettingsSection('preset');
    updateStage(openStageSurface(closeStageSurface(stageRef.current, 'methods'), { id: 'settings', kind: 'settings', title: 'Settings' }));
  }, [activeStageTabId]);
  function updateBuffers(next: Record<string, DocumentBuffer>) { buffersRef.current = next; setBuffers(next); }
  function protectDraft(current: DocumentBuffer): boolean {
    if (!isDocumentDirty(current)) return true;
    try {
      localStorage.setItem(draftKey(current.file.id), JSON.stringify({ name: current.file.name, content: current.content, savedAt: new Date().toISOString() }));
      return true;
    } catch {
      setError('This edit is still open, but its recovery draft could not be saved in this browser. Save the file before closing it.');
      return false;
    }
  }
  function setContent(value: string | ((current: string) => string)) {
    const id = stageRef.current.activeId;
    const current = id ? buffersRef.current[id] : undefined;
    if (!id || !current || !ready) return;
    contextEpoch.current += 1;
    const next = { ...current, content: typeof value === 'function' ? value(current.content) : value };
    protectDraft(next);
    updateBuffers({ ...buffersRef.current, [id]: next });
    setProposal(null);
  }
  function openStageTab(tab: StageSurface) {
    if (tab.kind === 'document') {
      const file = files.find((item) => item.id === tab.fileId);
      if (file) void openFile(file);
    } else if (isWorkspaceSurfaceId(tab.id)) openWorkspaceSurface(tab.id);
    else if (tab.kind === 'settings' || tab.kind === 'methods') openSettingsWorkspace(tab.kind === 'methods' ? 'preset' : settingsSection);
    else updateStage(openStageSurface(stageRef.current, tab));
  }
  function closeStageTab(tab: StageSurface) {
    const current = buffersRef.current[tab.id];
    if (current) protectDraft(current);
    closeWorkspaceView(tab.id);
    const next = { ...buffersRef.current };
    delete next[tab.id];
    updateBuffers(next);
  }
  useEffect(() => {
    if (!ready) return;
    for (const tab of stage.surfaces) {
      if (tab.kind !== 'document') continue;
      const file = files.find((item) => item.id === tab.fileId);
      if (file) void loadBuffer(file);
      else if (externalFileTarget(tab.fileId) && !buffersRef.current[tab.fileId]) void loadBuffer({ id: tab.fileId, name: tab.title, content: '', version: '' });
    }
  }, [ready, stage, files]);

  const toggleFiles = useCallback(() => {
    setFilesOpen((open) => {
      const next = !open;
      if (isCompactViewport()) {
        if (next) setChatOpen(false);
      } else if (window.innerWidth < ALL_PANELS_MIN) {
        if (next) setChatOpen(false);
      } else {
        localStorage.setItem('air-office:files-open', next ? '1' : '0');
      }
      return next;
    });
  }, []);
  const toggleChat = useCallback(() => {
    setChatOpen((open) => {
      const next = !open;
      if (isCompactViewport()) {
        if (next) setFilesOpen(false);
      } else if (window.innerWidth < ALL_PANELS_MIN) {
        if (next) setFilesOpen(false);
      } else {
        localStorage.setItem('air-office:chat-open', next ? '1' : '0');
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const next = resolveTheme(themeChoice);
      setResolvedTheme(next);
      document.documentElement.dataset.theme = next;
      // HeroUI v3 reads the `dark` class on <html> for its dark theme.
      // Our `data-theme` attribute stays the source of truth for our own
      // tokens; the class is only the HeroUI bridge.
      document.documentElement.classList.toggle('dark', next === 'dark');
    };
    apply();
    if (themeChoice !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [themeChoice]);

  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, themeChoice); } catch { /* The theme stays session-scoped when storage is full. */ }
  }, [themeChoice]);

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${COMPACT_MAX}px)`);
    const panels = window.matchMedia(`(min-width: ${ALL_PANELS_MIN}px)`);
    const sync = () => {
      setViewportWidth(window.innerWidth);
      const next = media.matches;
      setCompact(next);
      if (next) {
        setFilesOpen(false);
        setChatOpen(false);
      } else if (panels.matches) {
        setFilesOpen(localStorage.getItem('air-office:files-open') !== '0');
        setChatOpen(localStorage.getItem('air-office:chat-open') !== '0');
      } else {
        const assistant = localStorage.getItem('air-office:chat-open') !== '0';
        setChatOpen(assistant);
        setFilesOpen(!assistant && localStorage.getItem('air-office:files-open') !== '0');
      }
    };
    const onResize = () => setViewportWidth(window.innerWidth);
    sync();
    media.addEventListener('change', sync);
    panels.addEventListener('change', sync);
    window.addEventListener('resize', onResize);
    return () => {
      media.removeEventListener('change', sync);
      panels.removeEventListener('change', sync);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || document.querySelector('dialog:modal')) return;
      if (event.key === 'Escape' && isCompactViewport() && (filesOpen || chatOpen)) {
        event.preventDefault();
        setFilesOpen(false);
        setChatOpen(false);
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === '\\') { event.preventDefault(); toggleFiles(); }
      else if (event.key === '/') { event.preventDefault(); toggleChat(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFiles, toggleChat, filesOpen, chatOpen]);

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = event.clientX - drag.startX;
      const next = drag.side === 'left'
        ? clamp(drag.startWidth + delta, drag.minWidth, drag.maxWidth)
        : clamp(drag.startWidth - delta, drag.minWidth, drag.maxWidth);
      const share = persistRailShare(drag.side, next, window.innerWidth);
      if (drag.side === 'left') setLeftShare(share);
      else setRightShare(share);
    }
    function onUp() { dragRef.current = null; document.body.classList.remove('resizing'); }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, []);

  function resetRailToDefault(side: 'left' | 'right') {
    if (!canResize) return;
    const preferred = clamp(Math.max(RAIL_DEFAULT, viewportWidth * RAIL_SHARE_DEFAULT), RAIL_MIN, RAIL_MAX);
    dragRef.current = null;
    document.body.classList.remove('resizing');
    if (side === 'left') {
      setRightShare(persistRailShare('right', rightSize || rightWidth, viewportWidth));
      setLeftShare(persistRailShare('left', preferred, viewportWidth));
    } else {
      setLeftShare(persistRailShare('left', leftSize || leftWidth, viewportWidth));
      setRightShare(persistRailShare('right', preferred, viewportWidth));
    }
  }

  function startDrag(side: 'left' | 'right', event: React.PointerEvent) {
    if (!canResize) return;
    // The second press of a double-click resets; do not start a drag.
    if (event.detail > 1) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const other = side === 'left' ? rightSize : leftSize;
    // Lock the opposite rail at its current fitted width so a share-based
    // resize of this side does not also reflow the other panel.
    if (side === 'left') setRightShare(persistRailShare('right', rightSize || rightWidth, viewportWidth));
    else setLeftShare(persistRailShare('left', leftSize || leftWidth, viewportWidth));
    const limits = railLimitsFor(viewportWidth, side);
    const budget = Math.max(limits.min, viewportWidth - SHELL_CHROME - stageFloorFor(viewportWidth) - other);
    dragRef.current = {
      side,
      startX: event.clientX,
      startWidth: side === 'left' ? leftSize : rightSize,
      minWidth: limits.min,
      maxWidth: Math.min(limits.max, budget),
    };
    document.body.classList.add('resizing');
  }

  async function refresh(resetDocuments = false) {
    const epoch = scopeEpoch.current;
    const listed = await adapter.list();
    if (epoch !== scopeEpoch.current) return;
    setFiles(listed);
    updateStage(reconcileStageScope(stageRef.current, [...listed.map((file) => file.id), ...stageRef.current.surfaces.filter((surface) => externalFileTarget(surface.id)).map((surface) => surface.id)], resetDocuments), undefined, true);
    updateBuffers(Object.fromEntries(Object.entries(buffersRef.current).filter(([id]) => stageRef.current.surfaces.some((tab) => tab.id === id))));
  }
  useEffect(() => { void (async () => { try { await adapter.restoreAuthorization(); await refresh(); setReady(true); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not restore workspace.'); } })(); }, [adapter]);
  async function loadBuffer(file: FileSnapshot): Promise<void> {
    if (buffersRef.current[file.id]) return;
    const pending = loading.current.get(file.id);
    if (pending) return pending;
    const epoch = scopeEpoch.current;
    setOpeningFileIds((current) => {
      if (current.has(file.id)) return current;
      const next = new Set(current);
      next.add(file.id);
      return next;
    });
    const task = (async () => {
      try {
        const target = externalFileTarget(file.id);
        const latest = target ? await explorerFiles.read(target) : await adapter.read(file.id);
        if (epoch !== scopeEpoch.current || !stageRef.current.surfaces.some((tab) => tab.id === file.id)) return;
        let recovered: string | undefined;
        try {
          const draft: unknown = JSON.parse(localStorage.getItem(draftKey(file.id)) ?? 'null');
          if (draft && typeof draft === 'object' && 'content' in draft && typeof draft.content === 'string' && draft.content !== latest.content) recovered = draft.content;
        } catch { /* Preserve malformed drafts rather than deleting user data. */ }
        const fileBuffer = createDocumentBuffer(latest, recovered);
        if (isMarkdownFile(latest.name)) {
          try { localStorage.setItem(`${draftKey(file.id)}:source`, fileBuffer.content); }
          catch { setError('Could not save this draft locally. Your document is still open.'); }
        }
        updateBuffers({ ...buffersRef.current, [file.id]: fileBuffer });
      } catch (reason) {
        if (epoch !== scopeEpoch.current) return;
        const message = reason instanceof Error ? reason.message : 'Could not open file.';
        const folderGone = /connected folder is unavailable|connected folder is no longer available|location changed/i.test(message);
        const externalTargetGone = externalFileTarget(file.id) && /no longer exists|no longer available/i.test(message);
        if (!externalFileTarget(file.id) || folderGone || externalTargetGone) updateStage(closeStageSurface(stageRef.current, file.id));
        if (folderGone) setNotice('A connected folder is no longer available. Its open files were closed.');
        else setError(message);
      } finally {
        if (epoch === scopeEpoch.current) loading.current.delete(file.id);
        setOpeningFileIds((current) => {
          if (!current.has(file.id)) return current;
          const next = new Set(current);
          next.delete(file.id);
          return next;
        });
      }
    })();
    loading.current.set(file.id, task);
    return task;
  }
  async function openFile(file: FileSnapshot) {
    if (!ready) return;
    updateStage(openStageSurface(stageRef.current, { id: file.id, kind: 'document', fileId: file.id, title: file.name }));
    await loadBuffer(file);
    if (isCompactViewport()) setFilesOpen(false);
  }
  async function openExternalFile(target: FilesystemTarget) {
    try { await openFile(await explorerFiles.read(target)); }
    catch (reason) {
      if (reason instanceof Error && /UTF-8|binary|text|size|limit/i.test(reason.message)) {
        const id = externalFileId(target);
        updateStage(openStageSurface(stageRef.current, { id, kind: 'file-preview', fileId: id, title: target.path.split('/').at(-1) ?? target.path }));
      } else {
        setError(reason instanceof Error ? reason.message : 'The file could not be opened.');
      }
    }
  }
  function reconcileDiskMutation(target: FilesystemTarget, destination: FilesystemTarget | null) {
    const remap = (id: string): string | null => {
      const file = externalFileTarget(id);
      if (!file || file.rootId !== target.rootId || file.path !== target.path && !file.path.startsWith(`${target.path}/`)) return id;
      return destination ? externalFileId({ rootId: destination.rootId, path: `${destination.path}${file.path.slice(target.path.length)}` }) : null;
    };
    const nextBuffers: Record<string, DocumentBuffer> = {};
    for (const [id, current] of Object.entries(buffersRef.current)) {
      const nextId = remap(id);
      if (nextId === id) { nextBuffers[id] = current; continue; }
      protectDraft(current);
      if (!nextId) continue;
      const moved = externalFileTarget(nextId);
      const next = { ...current, file: { ...current.file, id: nextId, name: moved?.path.split('/').at(-1) ?? current.file.name } };
      nextBuffers[nextId] = next;
      if (isDocumentDirty(next)) protectDraft(next);
    }
    updateBuffers(nextBuffers);
    const surfaces = stageRef.current.surfaces.flatMap((surface): StageSurface[] => {
      if (surface.kind !== 'document' && surface.kind !== 'file-preview') return [surface];
      const nextId = remap(surface.fileId);
      if (nextId === null) return [];
      if (nextId === surface.fileId) return [surface];
      return [{ ...surface, id: nextId, fileId: nextId, title: externalFileTarget(nextId)?.path.split('/').at(-1) ?? surface.title }];
    });
    const activeId = stageRef.current.activeId ? remap(stageRef.current.activeId) : null;
    updateStage({ ...stageRef.current, surfaces, activeId: activeId && surfaces.some((surface) => surface.id === activeId) ? activeId : surfaces.at(-1)?.id ?? null });
    setNotice(destination ? 'File moved.' : 'Moved to trash. Open drafts remain in recovery.');
  }
  async function saveFile() {
    if (!active || !buffer || !ready) return;
    const epoch = scopeEpoch.current;
    const submitted = buffer;
    try {
      const target = externalFileTarget(active.id);
      const result = target ? await explorerFiles.save(target, submitted.content, submitted.file.version) : await adapter.save(active.id, submitted.content, submitted.file.version);
      if (epoch !== scopeEpoch.current) return;
      const current = buffersRef.current[result.id];
      if (current) {
        const next = saveDocumentBuffer(current, result);
        updateBuffers({ ...buffersRef.current, [result.id]: next });
        if (isDocumentDirty(next)) protectDraft(next);
        else localStorage.removeItem(draftKey(result.id));
      }
      if (fileRichEdits[active.id]) {
        const edits = { ...fileRichEdits, [active.id]: { ...fileRichEdits[active.id]!, saved: true } };
        localStorage.setItem('air-office:markdown-rich-edits', JSON.stringify(edits));
        setFileRichEdits(edits);
      }
      await refresh(); setError('');
      setFileConflict(null);
    } catch (reason) {
      if (epoch === scopeEpoch.current) {
        const message = reason instanceof Error ? reason.message : 'Save failed.';
        setError(message);
        setFileConflict(/409|changed externally|version conflict|stale/i.test(message) ? active.id : null);
      }
    }
  }
  async function reloadConflictedFile() {
    if (!fileConflict) return;
    const id = fileConflict;
    const current = buffersRef.current[id];
    if (current && !protectDraft(current)) return;
    try {
      const target = externalFileTarget(id);
      const latest = target ? await explorerFiles.read(target) : await adapter.read(id);
      updateBuffers({ ...buffersRef.current, [id]: createDocumentBuffer(latest) });
      setFileConflict(null);
      setError('');
      setNotice('Latest file loaded. Your previous edits remain in the recovery draft.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reload the latest file.');
    }
  }
  /**
   * Builds the next chat request: resolved instructions from attached methods,
   * the selected agent or the picked model, and retrieved agent knowledge as
   * disclosed context. It reports missing prompt variables rather than sending
   * a half-filled instruction.
   */
  async function buildChatRequest(turns: ChatTurn[], context: string): Promise<ChatRunRequest> {
    const attached = methods.definitions.filter((definition) => attachedMethodIds.includes(definition.value.id));
    // Selected skills (including AI-safety and governance skills) stay fully inlined so they govern every turn.
    // Copilot skillProvider still offers the wider installed catalog for on-demand loads.
    const resolved = resolveMethodInstructions(attached, promptValues, methods.definitions, { skillBodies: 'inline' });
    if (resolved.missing.length) throw new Error(`Fill the prompt variables before sending: ${resolved.missing.join(', ')}.`);
    const effectiveTurns: ChatTurn[] = resolved.content ? [{ role: 'system', content: resolved.content }, ...turns] : turns;
    const selectedAgent = attached.find((definition) => definition.kind === 'preset');
    const inherited = inheritedChatSettings(selectedAgent ? { provider: selectedAgent.value.provider, model: selectedAgent.value.model, settings: selectedAgent.value.settings } : null, catalogSelectionRef.current);
    const resolvedSettings = resolveChatSettings(inherited, chatSettingsRef.current);
    const selectedProvider = resolvedSettings.provider;
    if (!selectedProvider || !resolvedSettings.model) throw new Error('Choose a model in chat or Settings before sending.');
    const connection = providerCatalog.providers.find((provider) => provider.id === selectedProvider);
    if (!connection?.models.includes(resolvedSettings.model)) throw new Error('The selected model is unavailable. Repair its connection or choose a replacement.');
    // Settings owns which tools are enabled. Chat uses those defaults plus any agent tools; it does not narrow the set in the composer.
    // Only ids present in the live /api/v1/tools catalog are sent.
    const agentToolIds = (selectedAgent?.value.toolIds ?? []).filter((id) => availableToolIds.includes(id));
    const mergedToolIds = effectiveToolIds(defaultToolIds, agentToolIds).filter((id) => availableToolIds.includes(id));
    const supportsTools = typeof connection.capabilities === 'object' && connection.capabilities !== null && 'tools' in connection.capabilities && connection.capabilities.tools === true;
    let knowledgeContext = context;
    let knowledgeSources = knowledge.results;
    if (!selectedAgent?.value.knowledgeCollectionIds.length) { setAgentKnowledgeSources([]); setAgentKnowledgePreview(''); }
    if (selectedAgent?.value.knowledgeCollectionIds.length) {
      try {
        const retrieved = await serviceClient.json<{ results: typeof knowledge.results }>('/api/v1/search', { method: 'POST', body: JSON.stringify({ collectionIds: selectedAgent.value.knowledgeCollectionIds, query: turns.at(-1)?.content ?? '', ...knowledgeSearchOptions() }) });
        setAgentKnowledgePreview(retrieved.results.map((result) => `${result.resolved ? 'Resolved source' : 'Unresolved source'} ${result.sourceVersionId}: ${result.text}`).join('\n\n'));
        knowledgeSources = retrieved.results;
        setAgentKnowledgeSources(retrieved.results);
        setNotice(`Included ${retrieved.results.length} knowledge snippet(s) from this agent's selected collections.`);
      } catch { throw new Error('The selected agent knowledge could not be retrieved. The message was not sent.'); }
    }
    // Knowledge attached in the composer is retrieved from the collections and
    // documents the person chose, and travels with the message as disclosed
    // context. The selection says what may be searched; the service decides
    // what is actually returned.
    //
    // An empty answer is disclosed, not hidden. A person who attached a
    // document expects the model to read it, and a message that quietly
    // carries no context is indistinguishable from a model that ignored the
    // document.
    const attachedCollectionIds = contextCollectionIds(contextSelection);
    if (attachedCollectionIds.length) {
      try {
        const retrieved = await serviceClient.json<{ results: typeof knowledge.results }>('/api/v1/search', { method: 'POST', body: JSON.stringify({
          collectionIds: attachedCollectionIds,
          ...(contextSelection.documents.length ? { documentIds: contextSelection.documents.map((document) => document.id), wholeCollectionIds: contextSelection.collections.map((collection) => collection.id) } : {}),
          query: turns.at(-1)?.content ?? '',
          ...knowledgeSearchOptions()
        }) });
        knowledgeSources = retrieved.results;
        const outcome = contextRetrievalOutcome({ attached: true, results: retrieved.results });
        setContextOutcome(outcome);
        setNotice(contextRetrievalNotice(outcome));
      } catch { throw new Error('The attached knowledge could not be retrieved. The message was not sent.'); }
    } else {
      setContextOutcome(contextRetrievalOutcome({ attached: false, results: [] }));
    }
    const currentDocument = getActiveDocument();
    const externalTarget = active ? externalFileTarget(active.id) : null;
    const externalRoot = externalTarget ? connectedRoots.find((root) => root.id === externalTarget.rootId) : undefined;
    // Code's open folder wins so Copilot shell/file tools share that tree; else the open connected file or first mount.
    const preferredRoot = codeFolder ?? externalRoot?.path ?? connectedRoots[0]?.path;
    const documentContext = richDocumentActive && currentDocument
      ? (() => {
          const vaultPath = currentDocument.path
            ? currentDocument.path.replace(/\.note\.json$/i, '.md')
            : currentDocument.id;
          return {
            fileName: `${currentDocument.title}.note`,
            // Vault-relative .md path so lean/Copilot tools address the note pair without id tutoring.
            fileId: `${CHAT_NOTE_FILE_ID_PREFIX}${vaultPath}`,
          };
        })()
      : active
        ? { fileName: active.name, fileId: active.id, ...(externalTarget ? { workspaceFilePath: externalTarget.path } : {}) }
        : undefined;
    return {
      runId: crypto.randomUUID(),
      model: resolvedSettings.model,
      ...(selectedProvider ? { provider: selectedProvider } : {}),
      ...(Object.keys(resolvedSettings.settings).length ? { settings: resolvedSettings.settings } : {}),
      commandPermission,
      ...(preferredRoot ? { preferredWorkspaceRoot: preferredRoot } : {}),
      ...(supportsTools && mergedToolIds.length > 0 ? { toolIds: mergedToolIds } : {}),
      ...(supportsTools && agentToolIds.length ? { preferredToolIds: agentToolIds.filter((id) => mergedToolIds.includes(id)) } : {}),
      messages: effectiveTurns,
      context: knowledgeContext || documentContext || knowledgeSources.length ? { ...(knowledgeSources.length ? { sources: knowledgeSources } : {}), ...(knowledgeContext ? { selection: knowledgeContext } : {}), ...documentContext } : undefined
    };
  }

  const conversationClient = useMemo(() => createConversationClient(serviceClient), [serviceClient]);
  const chatAsk = useChatAskQueue();
  const chatApproval = useChatApprovalQueue();
  const openWorkspacePath = useCallback((path: string) => {
    const resolved = resolveWorkspaceOpenTarget(path, connectedRoots);
    if (!resolved) {
      setError('That file is outside the workspace.');
      return;
    }
    if (resolved.kind === 'connected') {
      void openExternalFile(resolved.target);
      return;
    }
    if (resolved.kind === 'vault-note') {
      void openNoteById(resolved.path);
      return;
    }
    // Non-note vault files: try note API for .md/.note.json, otherwise show a clear notice.
    void (async () => {
      try {
        const note = await serviceClient.json<{ document: RichDocument }>(`/api/v1/rich-documents/${encodeURIComponent(resolved.path)}`);
        await openRichNote(note.document);
      } catch {
        setError(`Opened path ${resolved.path} is in the workspace but has no stage preview yet.`);
      }
    })();
  }, [connectedRoots, serviceClient]);
  const openInCode = (input: { rootPath: string; filePath?: string }) => {
    setCodeReveal((current) => ({
      rootPath: input.rootPath,
      ...(input.filePath ? { filePath: input.filePath } : {}),
      key: (current?.key ?? 0) + 1,
    }));
    openWorkspaceSurface('code');
    void serviceClient.json<{ roots: ConnectedRoot[] }>('/api/v1/external/roots')
      .then(({ roots }) => setConnectedRoots(roots))
      .catch(() => undefined);
  };
  const chat = useChatRuntime({
    client: serviceClient,
    conversations: conversationClient,
    buildRequest: buildChatRequest,
    getContext: () => selection.trim(),
    onError: setError,
    onNotice: setNotice,
    onUserInput: chatAsk.ask,
    onToolApproval: (input) => chatApproval.request(input),
    onOpenWorkspacePath: openWorkspacePath,
    onOpenInCode: openInCode,
  });
  const [chatSettings, setChatSettings] = useState<ChatComposerSettings>({});
  chatSettingsRef.current = chatSettings;
  const [commandPermission, setCommandPermission] = useState<'ask' | 'allow-all'>(() => localStorage.getItem('air-office:command-permission') === 'allow-all' ? 'allow-all' : 'ask');
  function changeCommandPermission(value: 'ask' | 'allow-all') {
    setCommandPermission(value);
    localStorage.setItem('air-office:command-permission', value);
  }
  useEffect(() => {
    const next = readChatSettings(window.localStorage, chat.conversationId);
    chatSettingsRef.current = next;
    setChatSettings(next);
  }, [chat.conversationId]);

  /** Enabled tool ids from Settings; chat sends these defaults (plus agent tools) on each run. */
  const [defaultToolIds, setDefaultToolIds] = useState<string[]>([]);
  const [availableToolIds, setAvailableToolIds] = useState<string[]>([]);
  const refreshToolCatalog = useCallback(() => {
    serviceClient.json<{ defaultChatToolIds?: string[]; chatAvailableToolIds?: string[] }>('/api/v1/tools')
      .then((body) => {
        const available = body.chatAvailableToolIds ?? body.defaultChatToolIds ?? [];
        setDefaultToolIds(body.defaultChatToolIds ?? available);
        setAvailableToolIds(available);
      })
      .catch(() => { setDefaultToolIds([]); setAvailableToolIds([]); });
  }, [serviceClient]);
  useEffect(() => {
    refreshToolCatalog();
    window.addEventListener('air-office:tools-changed', refreshToolCatalog);
    window.addEventListener('air-office:capabilities-changed', refreshToolCatalog);
    return () => { window.removeEventListener('air-office:tools-changed', refreshToolCatalog); window.removeEventListener('air-office:capabilities-changed', refreshToolCatalog); };
  }, [refreshToolCatalog]);

  /** Image capability of the selected provider (CHAT-045), resolved after the catalog loads. */

  function saveChatSettings(next: ChatComposerSettings) {
    chatSettingsRef.current = next;
    setChatSettings(next);
    writeChatSettings(window.localStorage, chat.conversationId, next);
  }
  function selectChatModel(modelKey: string) {
    const parsed = parseModelKey(modelKey);
    if (!parsed.provider || !parsed.model) return;
    providerCatalog.selectModel(modelKey);
    // Do not read React catalog state here: setState has not flushed yet.
    catalogSelectionRef.current = { provider: parsed.provider, model: parsed.model };
    const agent = methods.definitions.find((definition) => attachedMethodIds.includes(definition.value.id) && definition.kind === 'preset');
    const inherited = inheritedChatSettings(agent?.kind === 'preset' ? { provider: agent.value.provider, model: agent.value.model, settings: agent.value.settings } : null, catalogSelectionRef.current);
    const next = withModelOverride(chatSettingsRef.current, modelKey, inherited);
    saveChatSettings(withReasoningEffortForModel(next, reasoningOptionsForModel(providerCatalog, modelKey)));
  }
  function selectReasoningEffort(value: string) {
    if (!isChatReasoningEffort(value)) return;
    const agent = methods.definitions.find((definition) => attachedMethodIds.includes(definition.value.id) && definition.kind === 'preset');
    const inherited = inheritedChatSettings(agent?.kind === 'preset' ? { provider: agent.value.provider, model: agent.value.model, settings: agent.value.settings } : null, catalogSelectionRef.current);
    const modelKey = resolveChatSettings(inherited, chatSettingsRef.current).modelKey;
    const options = reasoningOptionsForModel(providerCatalog, modelKey);
    if (!options?.levels.includes(value)) return;
    saveChatSettings({ ...chatSettingsRef.current, reasoningEffort: value });
  }
  async function manageChatTags(id: string, currentTags: string[]) {
    const value = await dialogs.prompt({ title: 'Manage chat tags', label: 'Tags, separated by commas', initialValue: currentTags.join(', '), submitLabel: 'Save tags' });
    if (value === null) return;
    const tags = [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))];
    await chat.updateMeta(id, { tags }, 'These chat tags could not be saved.');
  }

  async function deleteChatRequest(id: string, confirmed = false) {
    if (!confirmed && !await dialogs.confirm({ title: 'Delete chat?', message: 'This chat will be removed from your history.', confirmLabel: 'Delete', destructive: true })) return;
    await chat.remove(id);
  }

  function getActiveDocument(): RichDocument | null {
    if (richDocumentActive && activeStageTabId) {
      const document = richBufferFor(activeStageTabId);
      if (document) return document;
    }
    if (active && isMarkdownFile(active.name)) return fileRichDocument;
    return null;
  }

  function clearDocumentProposal() {
    setProposal(null);
  }

  /**
   * Insert a chat response into the open note (CHAT-096). The text becomes a
   * cursor proposal for the open document, so the insert gets the same review,
   * apply and reject treatment as a model-proposed edit.
   */
  function insertIntoNote(text: string) {
    const clean = text.trim();
    if (!clean) return;
    const targetDoc = getActiveDocument();
    if (!targetDoc) { setError('Open a note before inserting a chat response.'); return; }
    setProposal(createDocumentAIProposal({
      document: targetDoc,
      scope: 'cursor',
      beforeText: '',
      afterText: clean,
      proposedMarkdown: clean
    }));
  }

  async function handleDocumentAIPrompt(userPrompt: string, selectedText: string) {
    if (chat.sending) {
      setError('Wait for the current chat reply to finish before rewriting.');
      return;
    }
    if (documentSending) return;
    const targetDoc = getActiveDocument();
    if (!targetDoc) {
      setError('Open a document before rewriting a selection.');
      return;
    }
    const attached = methods.definitions.filter((definition) => attachedMethodIds.includes(definition.value.id));
    const resolved = resolveMethodInstructions(attached, promptValues, methods.definitions);
    if (resolved.missing.length) { setError(`Fill the prompt variables before sending: ${resolved.missing.join(', ')}.`); return; }
    const selectedAgentDef = methods.definitions.find((definition) => attachedMethodIds.includes(definition.value.id) && definition.kind === 'preset');
    const selectedAgent = selectedAgentDef?.kind === 'preset' ? selectedAgentDef.value : undefined;
    /* Same model resolution as chat sends — per-chat / agent selection, not a bare catalog default. */
    const inherited = inheritedChatSettings(selectedAgent ? { provider: selectedAgent.provider, model: selectedAgent.model, settings: selectedAgent.settings } : null, catalogSelectionRef.current);
    const resolvedSettings = resolveChatSettings(inherited, chatSettingsRef.current);
    if (!resolvedSettings.provider || !resolvedSettings.model) {
      setError('Choose a model in chat before rewriting.');
      return;
    }
    const connection = providerCatalog.providers.find((provider) => provider.id === resolvedSettings.provider);
    if (!connection?.models.includes(resolvedSettings.model)) {
      setError('The selected model is unavailable. Choose another model, then rewrite again.');
      return;
    }
    const capturedEpoch = contextEpoch.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const beforeText = selectedText.trim();
    const promptTurn = beforeText
      ? `Revise this excerpt according to instruction: "${userPrompt}". Return only the revised passage, with no preface or quotation marks. Excerpt:\n${beforeText}`
      : `Write content to insert according to instruction: "${userPrompt}". Return only the new passage.`;

    setDocumentSending(true);
    try {
      const request: ChatRunRequest = {
        runId: crypto.randomUUID(),
        model: resolvedSettings.model,
        provider: resolvedSettings.provider,
        ...(Object.keys(resolvedSettings.settings).length ? { settings: resolvedSettings.settings } : {}),
        messages: [...(resolved.content ? [{ role: 'system' as const, content: resolved.content }] : []), { role: 'user', content: promptTurn }],
        context: beforeText
          ? { selection: beforeText, fileName: active?.name ?? targetDoc.title }
          : { fileName: active?.name ?? targetDoc.title }
      };

      const result = await streamRun({ request, signal: controller.signal, onApproval: (input) => confirmToolPermission(dialogs, input), onUserInput: (input) => answerAgentQuestion(dialogs, input) });
      const aiState = result.state;

      if (controller.signal.aborted || result.cancelled || capturedEpoch !== contextEpoch.current) throw new Error('The document changed or the run was cancelled. Generate a new proposal.');
      if (aiState.status !== 'complete') throw new Error(aiState.failure?.message ?? 'The rewrite did not complete.');
      const generated = [...aiState.messages].reverse().find((message) => message.role === 'assistant' && message.content.trim())?.content
        ?? aiState.messages.at(-1)?.content;
      if (!generated?.trim()) throw new Error('The rewrite returned no editable content. Try again or choose another model.');
      const finalText = generated.trim();
      /* Hash against the live document after the run so markdown-file bodies that
         finished hydrating during the wait are not immediately marked stale. */
      const latestDoc = getActiveDocument() ?? targetDoc;
      setProposal(createDocumentAIProposal({
        document: latestDoc,
        scope: beforeText ? 'selection' : 'cursor',
        beforeText: beforeText || '',
        afterText: finalText,
        proposedMarkdown: finalText
      }));
      setNotice('Rewrite ready in the document. Accept or reject it there.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The rewrite failed. The document is unchanged.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setDocumentSending(false);
    }
  }

  function applyProposal() {
    if (!proposal) return;
    const targetDoc = getActiveDocument();
    if (!targetDoc || isProposalStale(proposal, targetDoc)) {
      setError('This proposal is stale. Select the text again.');
      return;
    }
    const editor = activeEditorRef.current;
    if (!editor || (richDocumentActive ? richSourceMode : (active && (fileSourceMode[active.id] ?? false)))) {
      setError('Open the rich editor before applying this proposal. Source drafts remain unchanged.');
      return;
    }
    try {
      applyProposalToEditor(editor, proposal);
      setProposal(null);
      setNotice('Proposed edit applied to the document. Review it before saving.');
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : 'The edit could not be applied through the editor.'} The proposal is kept for review.`);
    }
  }

  async function localFoldersChanged() {
    setConnectedRoots((await serviceClient.json<{ roots: ConnectedRoot[] }>('/api/v1/external/roots')).roots);
    await explorerControls.current?.refresh();
  }
  async function workspaceCleared() {
    scopeEpoch.current += 1;
    contextEpoch.current += 1;
    abortRef.current?.abort();
    loading.current.clear();
    setOpeningFileIds(new Set());
    setResetRevision((value) => value + 1);
    setFiles([]);
    updateBuffers({});
    saveRichBuffers({});
    setFileRichEdits({});
    previousFileRichDocuments.current.clear();
    setConnectedRoots([]);
    setAttachedMethodIds([]);
    setSelection('');
    setProposal(null);
    updateStage({ version: 1, surfaces: [{ id: 'settings', kind: 'settings', title: 'Settings' }], activeId: 'settings' });
    await chat.open(null);
    await Promise.all([chat.refresh(), methods.refresh(), explorerControls.current?.refresh()]);
  }
  async function workspaceImported() {
    const epoch = scopeEpoch.current;
    const { documents } = await serviceClient.json<{ documents: unknown[] }>('/api/v1/rich-documents');
    const imported = await Promise.all(documents.map(ensureNativeRichDocument));
    if (epoch !== scopeEpoch.current) return;
    const next = { ...richBuffersRef.current };
    for (const document of imported) if (document && !next[document.id]) next[document.id] = document;
    saveRichBuffers(next);
    await Promise.all([chat.refresh(), explorerControls.current?.refresh()]);
  }
  const rootName = connectedRoots.map((root) => root.name).join(', ') || 'No local folders connected';
  const activeSurface = stageTabs.find((tab) => tab.id === activeStageTabId);
  const previewTarget = activeSurface?.kind === 'file-preview' ? externalFileTarget(activeSurface.fileId) : null;
  const attachedDefinitions = methods.definitions.filter((definition) => attachedMethodIds.includes(definition.value.id));
  const resolvedAttached = resolveMethodInstructions(attachedDefinitions, promptValues, methods.definitions);
  const attachedInstructions = resolvedAttached.content;
  const agentPreview = attachedDefinitions.find((definition) => definition.kind === 'preset');
  const inheritedSettings = inheritedChatSettings(agentPreview ? { provider: agentPreview.value.provider, model: agentPreview.value.model, settings: agentPreview.value.settings } : null, catalogSelectionRef.current);
  const effectiveChatSelection = resolveChatSettings(inheritedSettings, chatSettings);
  const visionSupport = providerCatalog.providers.find((provider) => provider.id === effectiveChatSelection.provider)?.modelFacts?.find((model) => model.modelId === effectiveChatSelection.model)?.capabilities.vision;
  const imagesAccepted = visionSupport === 'supported' ? true : visionSupport === 'unsupported' ? false : null;
  const namedStageTitle = activeSurface?.kind === 'chat-stage' ? 'Chat' : activeSurface?.kind === 'programs' ? 'Programs' : activeSurface?.kind === 'arcade' ? 'Arcade' : activeSurface?.kind === 'code' ? 'Code' : activeSurface?.kind === 'fellowship' ? 'Fellowship' : activeSurface?.kind === 'craft' ? 'Craft' : activeSurface?.kind === 'prompts' ? 'Notes' : activeSurface?.kind === 'teams' ? 'Teams' : activeSurface?.kind === 'market' ? 'Market' : activeSurface?.kind === 'media' ? 'Media' : activeSurface?.kind === 'today' ? 'Today' : activeSurface?.kind === 'calendar' ? 'Calendar' : activeSurface?.kind === 'search' ? 'Search' : activeSurface?.kind === 'apps' ? 'Actions' : activeSurface?.kind === 'glossary' ? 'Guides' : activeSurface?.kind === 'settings' || activeSurface?.kind === 'methods'
    ? 'Settings'
    : activeSurface && (activeSurface.kind === 'document' || activeSurface.kind === 'rich-document' || activeSurface.kind === 'file-preview')
      ? activeSurface.title
      : null;
  const showingClockTitle = welcomeSelected || !namedStageTitle;
  const documentTitle = showingClockTitle ? localClock : namedStageTitle;
  const canSaveDocument = Boolean(activeSurface && (activeSurface.kind === 'document' || activeSurface.kind === 'rich-document') && (active || richDocumentActive));
  function saveActiveDocument() {
    if (!canSaveDocument) return;
    if (richDocumentActive && activeStageTabId) void saveRichNote(activeStageTabId); else void saveFile();
  }
  /** Opens chat in the right rail. Does not change the stage selection — Welcome is
   *  `activeId: null`, and flipping Welcome off used to reveal a stale active surface. */
  function showChat(id?: string) {
    if (stageRef.current.activeId === 'chat-stage') updateStage(closeStageSurface(stageRef.current, 'chat-stage'));
    setRightMode('chat');
    if (!chatOpen) toggleChat();
    if (id) void chat.open(id);
    else chat.newConversation();
  }
  function openChatStage(id?: string) {
    if (id && id !== chat.conversationId) void chat.open(id);
    updateStage(openStageSurface(stageRef.current, { id: 'chat-stage', kind: 'chat-stage', title: 'Chat' }));
    setSelection(selection);
    setProposal(proposal);
    setRightMode('directory');
  }
  function startAgent(id: string) {
    if (chat.sending) return;
    if (!attachedMethodIds.includes(id)) toggleAttachedMethod(id);
    showChat();
  }
  function selectChatAgent(id: string) {
    setAgentKnowledgePreview('');
    localStorage.setItem('air-office:chat-agent', id);
    const currentPreset = attachedMethodIds.find((methodId) => methods.definitions.find((definition) => definition.value.id === methodId)?.kind === 'preset');
    if (!id) {
      if (!currentPreset) return;
      const next = attachedMethodIds.filter((methodId) => methodId !== currentPreset);
      localStorage.setItem('air-office:attached-methods', JSON.stringify(next));
      setAttachedMethodIds(next);
      return;
    }
    if (currentPreset === id) return;
    toggleAttachedMethod(id);
  }
  function showFiles() {
    setLeftMode('files');
    if (!filesOpen) toggleFiles();
  }
  function openFellowshipDestination(destination: FellowshipOfficeDestination, scopeId?: string) {
    if (scopeId) setResearchScopeId(scopeId);
    if (destination === 'programs') { openPrograms(scopeId); return; }
    if (destination === 'craft') { openWorkspaceSurface('craft'); return; }
    if (destination === 'library') { showFiles(); if (scopeId) explorerControls.current?.reveal(scopeId); return; }
    openWorkspaceSurface(destination === 'teams' ? 'teams' : destination === 'prompts' ? 'prompts' : 'glossary');
  }
  async function openFellowshipReviewApp(appId: FellowshipReviewAppId, scopeId?: string) {
    if (!scopeId) throw new Error('Choose a project to review.');
    const { nodes } = await serviceClient.json<{ nodes: { id: string; kind: string; parentId: string | null }[] }>('/api/v1/workspace/nodes');
    const scope = nodes.find((node) => node.id === scopeId && (node.kind === 'project' || node.kind === 'program'));
    if (!scope) throw new Error('This project is no longer available. Choose another project.');
    const scopes = scope.kind === 'project' && scope.parentId ? [scope.parentId, scope.id] : [scope.id];
    const skipped: string[] = [];
    for (const id of scopes) {
      const refreshed = await serviceClient.json<{ skipped: { name: string; reason: string }[] }>(`/api/v1/workspace/scopes/${encodeURIComponent(id)}/knowledge`, { method: 'POST' });
      skipped.push(...refreshed.skipped.map((item) => `${item.name}: ${item.reason}`));
    }
    const material = await serviceClient.json<{ name: string; instruction: string; sources: { name: string; versionId: string; text: string }[] }>(`/api/v1/workspace/scopes/${encodeURIComponent(scopeId)}/material`);
    if (!material.sources.length) throw new Error('Add a note or readable file to this project before starting a review.');
    const text = material.sources.map((source) => `## ${source.name}\n\n${source.text}`).join('\n\n');
    if (text.length > 200_000) throw new Error('This project has more material than one review can accept. Use a smaller project or review a document in Actions.');
    setProjectReview({ id: crypto.randomUUID(), appId, scopeId, scopeName: material.name, text, sources: material.sources.map(({ name, versionId }) => ({ name, versionId })), instructions: material.instruction + (skipped.length ? `\n\nSources unavailable for this review:\n${skipped.join('\n')}` : '') });
    setNotice('');
    setResearchScopeId(scopeId);
    focusAppsWorkspace(appId);
  }
  async function saveProjectReview(review: ProjectReview, markdown: string, appName: string) {
    const versions = review.sources.map((source) => `- ${source.name}: ${source.versionId}`).join('\n');
    const stored = await createPreparedNote(`${appName}: ${review.scopeName}`, `# ${appName}\n\nProject: ${review.scopeName}\n\n${markdown}\n\n## Scope and constraints\n\n${review.instructions}\n\n## Imported source versions\n\n${versions || 'Source text was supplied directly.'}\n\n## Source record\n\n${review.text}`);
    await filePreparedNote(stored, review.scopeId);
    await serviceClient.json(`/api/v1/workspace/scopes/${encodeURIComponent(review.scopeId)}/knowledge`, { method: 'POST' });
  }
  async function saveEdition(markdown: string, title: string) {
    const document: RichDocument = { ...createRichDocument(title), body: markdownToNativeBody(markdown) };
    const { document: stored } = await serviceClient.json<{ document: RichDocument }>('/api/v1/rich-documents', { method: 'POST', body: JSON.stringify(document) });
    saveRichBuffers({ ...richBuffersRef.current, [stored.id]: stored });
    await openRichNote(stored);
  }
  const inStageChat = !welcomeSelected && activeStageTabId === 'chat-stage';
  const [stageChatHost, setStageChatHost] = useState<HTMLElement | null>(null);
  const [railChatHost, setRailChatHost] = useState<HTMLElement | null>(null);
  const [chatPortalHost] = useState(() => document.createElement('div'));
  useLayoutEffect(() => {
    const target = inStageChat ? stageChatHost : railChatHost;
    if (!target) return;
    chatPortalHost.className = inStageChat ? 'stage-chat' : 'rail-mode-body chat-mode';
    target.appendChild(chatPortalHost);
  }, [inStageChat, stageChatHost, railChatHost, chatPortalHost]);
  useEffect(() => () => chatPortalHost.remove(), [chatPortalHost]);
  const agents = methods.definitions
    .filter((definition) => definition.kind === 'preset' && definition.value.modelReference?.role !== 'background')
    .slice()
    .sort((left, right) => {
      if (left.value.id === AIR_OFFICE_AGENT_ID) return -1;
      if (right.value.id === AIR_OFFICE_AGENT_ID) return 1;
      return left.value.name.localeCompare(right.value.name, undefined, { sensitivity: 'base' });
    });
  useEffect(() => {
    if (!methods.definitions.some((definition) => definition.kind === 'preset' && definition.value.id === AIR_OFFICE_AGENT_ID)) return;
    const stored = localStorage.getItem('air-office:chat-agent');
    setAttachedMethodIds((current) => {
      const currentPreset = current.find((methodId) => methods.definitions.find((definition) => definition.value.id === methodId)?.kind === 'preset');
      let target: string;
      if (stored !== null) target = stored;
      else if (currentPreset) {
        localStorage.setItem('air-office:chat-agent', currentPreset);
        return current;
      } else {
        target = AIR_OFFICE_AGENT_ID;
        localStorage.setItem('air-office:chat-agent', target);
      }
      if (!target) {
        if (!currentPreset) return current;
        const next = current.filter((methodId) => methodId !== currentPreset);
        localStorage.setItem('air-office:attached-methods', JSON.stringify(next));
        return next;
      }
      if (!methods.definitions.some((definition) => definition.value.id === target && definition.kind === 'preset')) {
        target = AIR_OFFICE_AGENT_ID;
        localStorage.setItem('air-office:chat-agent', target);
      }
      if (currentPreset === target) return current;
      let next = current.filter((methodId) => methods.definitions.find((definition) => definition.value.id === methodId)?.kind !== 'preset');
      next = [...next, target];
      const selected = methods.definitions.find((definition) => definition.value.id === target);
      if (selected?.kind === 'preset') {
        for (const skillId of selected.value.skillIds) {
          if (!next.includes(skillId) && methods.definitions.some((definition) => definition.value.id === skillId && definition.kind === 'skill')) next = [...next, skillId];
        }
      }
      localStorage.setItem('air-office:attached-methods', JSON.stringify(next));
      return next;
    });
  }, [methods.definitions]);
  const selectionDocumentLabel = activeRichDocument?.title ?? active?.name ?? null;
  const chatRail = <ChatRail commandPermission={commandPermission} onCommandPermission={changeCommandPermission} inStage={inStageChat} onOpenStage={inStageChat ? undefined : () => openChatStage()} onOpenRail={inStageChat ? () => { updateStage(closeStageSurface(stageRef.current, 'chat-stage')); setRightMode('chat'); if (!chatOpen) toggleChat(); } : undefined} headerHost={inStageChat ? null : chatHeaderHost} dockHost={inStageChat ? undefined : chatDockHost} appearance={resolvedTheme} runtime={chat} agentAsk={chatAsk.active} toolApproval={chatApproval.active} selection={selection} selectionDocumentLabel={selectionDocumentLabel} onClearDocumentProposal={clearDocumentProposal} onOpenCitation={(versionId) => { const id = `source:${versionId}`; updateStage(openStageSurface(stageRef.current, { id, kind: 'knowledge-source', title: 'Source', fileId: id })); }} onOpenWorkspacePath={openWorkspacePath} mentionTargets={{
    notes: Object.values(richBuffers).map((note) => ({ id: note.path ?? note.id, title: note.title })),
    files: files.map((file) => ({ id: file.id, title: file.name })),
    conversations: chat.summaries.filter((item) => !item.archivedAt).map((item) => ({ id: item.id, title: item.title })),
  }} onOpenMention={(target) => {
    if (target.kind === 'note') { void openNoteById(target.id); return; }
    if (target.kind === 'conversation') { setRightMode('chat'); void chat.open(target.id); if (!chatOpen) toggleChat(); return; }
    if (target.kind === 'file') {
      const external = externalFileTarget(target.id) ?? connectedFileTarget(target.id, connectedRoots);
      if (external) { void openExternalFile(external); return; }
      const imported = files.find((file) => file.id === target.id || file.name === target.title);
      if (imported) void openFile(imported);
    }
  }} onInsertIntoNote={insertIntoNote} imagesAccepted={imagesAccepted} attached={attachedDefinitions} attachedInstructions={attachedInstructions} missingVariables={resolvedAttached.missing} promptValues={promptValues} onPromptValue={(id, name, value) => setPromptValues((current) => ({ ...current, [id]: { ...current[id], [name]: value } }))} onDetachAll={() => { localStorage.removeItem('air-office:attached-methods'); setAttachedMethodIds([]); }} onEditAttached={() => openSettingsWorkspace(attachedDefinitions.some((definition) => definition.kind === 'prompt') ? 'prompt' : attachedDefinitions.some((definition) => definition.kind === 'skill') ? 'skill' : 'preset')} agentPreview={agentPreview} agentKnowledgePreview={agentKnowledgePreview} agentKnowledgeSources={agentKnowledgeSources} knowledge={knowledge} contextSelection={contextSelection} onContextSelectionChange={setContextSelection} attachedContextOutcome={contextOutcome} agents={agents.map((agent) => ({ value: agent.value.id, label: agent.value.name }))} selectedAgent={agentPreview?.value.id ?? ''} onSelectAgent={selectChatAgent} onAgentSetup={() => openSettingsWorkspace('preset')} models={chatModelChoices(providerCatalog.providers, providerCatalog.demo).filter((item) => item.value === effectiveChatSelection.modelKey || !modelVisibility.hidden.includes(item.value)).sort((a, b) => Number(modelVisibility.pinned.includes(b.value)) - Number(modelVisibility.pinned.includes(a.value)) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }))} selectedModel={effectiveChatSelection.modelKey} onSelectModel={selectChatModel} reasoningLevels={(reasoningOptionsForModel(providerCatalog, effectiveChatSelection.modelKey)?.levels ?? []).map((level) => ({ value: level, label: reasoningEffortLabel(level) }))} reasoningEffort={effectiveChatSelection.settings.reasoningEffort ?? reasoningOptionsForModel(providerCatalog, effectiveChatSelection.modelKey)?.defaultLevel} onReasoningEffort={selectReasoningEffort} onModelSetup={() => openSettingsWorkspace('cloud-ai')} onFindModels={openModelMarket} localModels={localModels} activeFileName={active?.name ?? null} slashCommandsEnabled={chatSlashCommandsEnabled()} slashCommands={methods.definitions.filter((definition) => definition.kind === 'skill' || definition.kind === 'prompt').map((definition) => ({ id: definition.value.id, label: definition.value.name, description: definition.kind === 'skill' ? definition.value.description : 'Saved prompt' }))} onSlashCommand={(id) => { if (!attachedMethodIds.includes(id)) toggleAttachedMethod(id); }}/>;
  const handleWorkbenchVisibilityChange = useCallback((surface: 'controls' | 'assistant', visible: boolean) => {
    if (surface === 'controls') {
      setFilesOpen(visible);
      localStorage.setItem('air-office:files-open', visible ? '1' : '0');
    } else {
      setChatOpen(visible);
      localStorage.setItem('air-office:chat-open', visible ? '1' : '0');
    }
  }, []);
  return (
    <GlassScene appearance={resolvedTheme} material="regular" maxSurfaces={40} className={`app-shell ${filesOpen ? '' : 'files-collapsed'} ${chatOpen ? '' : 'chat-collapsed'} ${compact ? 'is-compact' : ''} ${titlebarSafe ? 'titlebar-safe' : ''}`} style={{ '--left-size': `${leftSize}px`, '--right-size': `${rightSize}px` } as React.CSSProperties}>
      <div className="titlebar-drag-region titlebar-drag-region-left" aria-hidden="true" />
      <div className="titlebar-drag-region titlebar-drag-region-right" aria-hidden="true" />
      <ChromeFloatingTipHost />
      {/* Dev walkthrough only: decorative macOS lights when ?macos-chrome=1 or VITE_MOCK_MACOS_CHROME. */}
      <div className="mock-macos-traffic-lights" aria-hidden="true">
        <span data-light="close" />
        <span data-light="minimize" />
        <span data-light="zoom" />
      </div>
      <FrostScrim className="shell-top-frost"/>
    <aside className="rail rail-left" aria-hidden={!filesOpen} inert={!filesOpen}>
      <div className="rail-left-scene">
      {/* Nav floats over full-bleed scroll; StageScrollbar keeps the thumb in the mid band under the chrome. */}
      <SidebarNavigation hostScene side="left" mode={leftMode} appearance={resolvedTheme} theme={themeChoice} onTheme={setThemeChoice} onMode={(mode) => { if (mode === 'home' || mode === 'files') setLeftMode(mode); }} onWelcome={selectWelcome} onSettings={() => openSettingsWorkspace()} modeActionsHostRef={setLibraryHeaderHost} modeActionsVisible={leftMode === 'files'} leadingAccessory={compact && filesOpen ? (
        <GlassScene className="workspace-action-scene sidebar-rail-toggle-scene" appearance={resolvedTheme} material="regular" maxSurfaces={1}>
          <GlassContent className="workspace-action-material sidebar-switch-material" aria-hidden="true"/>
          <GlassToolbar className="rail-toolbar" aria-label="Workspace rails" material="regular" appearance={resolvedTheme} radius={19}>
            <ChromeTooltip label="Back to document" placement="bottom">
              <GlassToolbarButton className="rail-toggle" size="icon" onClick={toggleFiles} aria-label="Collapse files" aria-pressed={filesOpen}><IconPanelLeft/></GlassToolbarButton>
            </ChromeTooltip>
          </GlassToolbar>
        </GlassScene>
      ) : undefined}/>
      {/* Frost sits above the scene waves and under the launcher/explorer chrome. */}
      <FrostScrim className="shell-bottom-frost shell-bottom-frost--rail-left"/>
      <GlassForeground className="rail-left-body">
        {leftMode === 'home' && <LauncherHome client={serviceClient} agents={agents} appearance={resolvedTheme} onAgent={startAgent} onSettings={openSettingsWorkspace} onCalendar={(date) => openWorkspaceSurface('calendar', date)} onFiles={() => showFiles()} onLibrary={() => showFiles()} onNote={(title) => { void createRichNote(title).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Note could not be created.')); }} onToday={() => openWorkspaceSurface('today')} onTeams={() => openWorkspaceSurface('teams')} onMarket={() => { setMarketCategory('all'); openWorkspaceSurface('market'); }} onPrompts={() => openWorkspaceSurface('prompts')} onArcade={() => openWorkspaceSurface('arcade')} onCode={() => openWorkspaceSurface('code')} onPrograms={() => openPrograms()} onFellowship={() => openWorkspaceSurface('fellowship')} onCraft={() => openWorkspaceSurface('craft')} onMedia={() => openWorkspaceSurface('media')} onApps={(id) => focusAppsWorkspace(id)} onGlossary={() => openWorkspaceSurface('glossary')}/>} 
        <div className="rail-mode-body explorer-mode" hidden={leftMode !== 'files'}>
        <ProgramExplorer key={resetRevision} client={serviceClient} controlsRef={explorerControls} appearance={resolvedTheme} headerHost={libraryHeaderHost}
          onOpenScope={openPrograms}
          notes={Object.values(richBuffers)} chats={chat.summaries} importedFiles={files}
          activeNoteId={richDocumentActive ? activeStageTabId : null} activeChatId={chat.conversationId} sending={chat.sending}
          onOpenNote={(id) => { void openNoteById(id); }}
          onOpenChat={(id, messageId) => { setRightMode('chat'); void chat.open(id, messageId); if (!chatOpen) toggleChat(); }}
          onOpenFile={openExternalFile} onOpenImport={(file) => void openFile(file)}
          onCreateNote={async (title) => { const note = await createRichNote(title); if (!note) throw new Error('Note creation was cancelled.'); return note; }}
          onRenameNote={renameRichNote} onCloneNote={cloneRichNote} onTrashNote={trashRichNote} onRestoreNote={restoreRichNote}
          onCreateChat={async () => { setRightMode('chat'); const id = await chat.createConversation(); if (!chatOpen) toggleChat(); return id; }}
          onRenameChat={async (id, title) => { await conversationClient.update(id, { title }); await chat.refresh(); }}
          onChatAction={async (id, action, confirmed) => {
            const summary = chat.summaries.find((item) => item.id === id);
            if (!summary) throw new Error('This chat is unavailable.');
            if (action === 'stage') { openChatStage(id); return; }
            if (action === 'pin') await conversationClient.update(id, { pinned: !summary.pinned });
            else if (action === 'archive') await conversationClient.update(id, { archived: !summary.archivedAt });
            else if (action === 'unread') await conversationClient.update(id, { unreadAt: new Date().toISOString() });
            else if (action === 'clone') await chat.clone(id);
            else if (action === 'tags') await manageChatTags(id, summary.tags);
            else await deleteChatRequest(id, confirmed);
            await chat.refresh();
          }}
          onChanged={async () => { const summaries = await chat.refresh(); if (summaries && chat.conversationId && !summaries.some((item) => item.id === chat.conversationId)) await chat.open(null); setConnectedRoots((await serviceClient.json<{ roots: ConnectedRoot[] }>('/api/v1/external/roots')).roots); }}
          onDiskMutation={reconcileDiskMutation}/>
        </div>
      </GlassForeground>
      <StageScrollbar scrollerId={leftMode === 'home' ? 'rail-left-home-scroll' : 'rail-left-files-scroll'} top="var(--rail-nav-height)" bottom="8px"/>
      </div>
    </aside>

    {canResize && filesOpen && <div className="resize-handle resize-left" onPointerDown={(event) => startDrag('left', event)} onDoubleClick={() => resetRailToDefault('left')} role="separator" tabIndex={0} aria-orientation="vertical" aria-label="Resize files panel" aria-valuemin={LEFT_MIN} aria-valuemax={LEFT_MAX} aria-valuenow={leftSize} onKeyDown={(event) => resizeRailWithKey('left', event)}/>}

    <div className="stage" ref={stageElementRef}>
    {/* Document scene clips to the card. Chrome is a sibling overlay (like sidebar nav)
        so press/hover growth is not shaved by overflow:hidden. */}
    <GlassScene className="stage-scene" material="regular" maxSurfaces={24} appearance={resolvedTheme} onDiagnostic={(diagnostic) => { if (diagnostic.error) console.error('[glass-scene] render error', diagnostic.error); }}>
      <GlassContent layout="flow" className="stage-body" id="stage-panel" role="region" aria-label="Document workspace">
        <div data-active-stage={welcomeSelected ? 'welcome' : activeStageTabId ?? 'empty'} className={activeStageTabId === 'arcade' && !welcomeSelected ? 'stage-page arcade-stage-page' : activeStageTabId === 'code' && !welcomeSelected ? 'stage-page code-stage-page' : activeStageTabId === 'settings' || activeStageTabId === 'methods' ? 'stage-page settings-stage-page' : activeSurface?.kind === 'file-preview' && !welcomeSelected ? 'stage-page file-preview-stage-page' : 'stage-page'}>
        {!welcomeSelected && activeStageTabId === 'chat-stage' && <section className="stage-chat-host" aria-label="Chat" ref={setStageChatHost} />}
        {stage.surfaces.some((surface) => surface.id === 'programs') && <Activity mode={!welcomeSelected && activeStageTabId === 'programs' ? 'visible' : 'hidden'}><ProgramsWorkspace onScopeChange={setResearchScopeId} initialScopeId={programScopeId} initialSection={programSection} visit={programVisit} onOpenIndexSettings={() => openSettingsWorkspace('knowledge')} chats={chat.summaries} onChanged={refreshPrograms} onCreateNote={createProgramNote} onStartChat={startProgramChat} onOpenNote={(id) => { void openNoteById(id); }} onOpenChat={(id) => showChat(id)} onOpenLibrary={(scopeId) => { showFiles(); explorerControls.current?.reveal(scopeId); }}/></Activity>}
        {stage.surfaces.some((surface) => surface.id === 'arcade') && <Activity mode={!welcomeSelected && activeStageTabId === 'arcade' ? 'visible' : 'hidden'}><ArcadeWorkspace appearance={resolvedTheme}/></Activity>}
        {stage.surfaces.some((surface) => surface.id === 'code') && <Activity mode={!welcomeSelected && activeStageTabId === 'code' ? 'visible' : 'hidden'}><CodeWorkspace client={serviceClient} appearance={resolvedTheme} reveal={codeReveal} onFolderChange={(folder) => {
          setCodeFolder(folder);
          void serviceClient.json<{ roots: ConnectedRoot[] }>('/api/v1/external/roots').then(({ roots }) => setConnectedRoots(roots)).catch(() => undefined);
        }}/></Activity>}
        {stage.surfaces.some((surface) => surface.id === 'fellowship') && <Activity mode={!welcomeSelected && activeStageTabId === 'fellowship' ? 'visible' : 'hidden'}><FellowshipWorkspace chats={chat.summaries} onOpenChat={showChat} onOpenNote={(id) => { void openNoteById(id); }} onPreparePackage={() => openSettingsWorkspace('craft', 'create')} initialScopeId={researchScopeId} onScopeChange={setResearchScopeId} onStartChat={resumeProjectChat} onCreateWorkspace={createFellowshipWorkspace} onCreateSubmissionDraft={createCraftSubmissionDraft} onOpenDestination={openFellowshipDestination} onOpenReviewApp={openFellowshipReviewApp}/></Activity>}
        {stage.surfaces.some((surface) => surface.id === 'craft') && <Activity mode={!welcomeSelected && activeStageTabId === 'craft' ? 'visible' : 'hidden'}><CraftWorkspace onOpenMarket={(request) => { setMarketCategory(request.category); setMarketFocus(current => ({ ...request, id: (current?.id ?? 0) + 1 })); openWorkspaceSurface('market'); }} onOpenKnowledge={() => openSettingsWorkspace('knowledge')} onChanged={async () => { await methods.refresh(); await knowledge.refresh(); }} onManageResources={() => openSettingsWorkspace('craft')} onOpenFellowship={() => openWorkspaceSurface('fellowship')}/></Activity>}
        {stage.surfaces.some((surface) => surface.id === 'prompts') && <Activity mode={!welcomeSelected && activeStageTabId === 'prompts' ? 'visible' : 'hidden'}><NotesWorkspace definitions={methods.definitions} richDocuments={Object.values(richBuffers)} onCreateNote={async (title) => { await createRichNote(title); }} onOpenNote={openRichNote} onManage={() => openSettingsWorkspace('prompt')} onNewPrompt={() => openSettingsWorkspace('prompt', 'create')} onUse={(id, values) => { setPromptValues((current) => ({ ...current, [id]: values })); if (!attachedMethodIds.includes(id)) toggleAttachedMethod(id); setRightMode('chat'); if (!chatOpen) toggleChat(); }}/></Activity>}
        {stage.surfaces.some((surface) => surface.id === 'apps') && <Activity mode={!welcomeSelected && activeStageTabId === 'apps' ? 'visible' : 'hidden'}><AppsWorkspace projectReview={projectReview} onOpenProject={openPrograms} onSaveProjectReview={saveProjectReview} initialAppId={appsFocus.appId} focusRequestId={appsFocus.requestId} appearance={resolvedTheme} catalog={providerCatalog} onSettings={() => openSettingsWorkspace('apps')} onNewApp={() => openSettingsWorkspace('apps', 'create')} onModels={() => openSettingsWorkspace('cloud-ai')} client={serviceClient} provider={providerCatalog.selectedProvider ?? ''} model={providerCatalog.selectedModel ?? ''}/></Activity>}
        {stage.surfaces.some((surface) => surface.id === 'glossary') && <Activity mode={!welcomeSelected && activeStageTabId === 'glossary' ? 'visible' : 'hidden'}><GlossaryWorkspace client={serviceClient} appearance={resolvedTheme}/></Activity>}
        {stage.surfaces.some((surface) => surface.id === 'teams') && <Activity mode={!welcomeSelected && activeStageTabId === 'teams' ? 'visible' : 'hidden'}><TeamsWorkspace agents={agents} sending={chat.sending} onChat={startAgent} onManage={() => openSettingsWorkspace('preset')} onSave={methods.save}/></Activity>}
        {stage.surfaces.some((surface) => surface.id === 'market') && <Activity mode={!welcomeSelected && activeStageTabId === 'market' ? 'visible' : 'hidden'}><MarketWorkspace focus={marketFocus} onOpenKnowledge={() => openSettingsWorkspace('knowledge')} onUseModel={(model) => { selectChatModel(`managed-local:${model}`); setRightMode('chat'); if (!chatOpen) toggleChat(); }} initialCategory={marketCategory} onModelSetup={() => openSettingsWorkspace('local-ai')} onOpenSchedules={() => openSettingsWorkspace('automations')} client={serviceClient} appearance={resolvedTheme} onInstalled={() => { void methods.refresh(); void knowledge.refresh(); }}/></Activity>}
        {stage.surfaces.some((surface) => surface.id === 'media') && <Activity mode={!welcomeSelected && activeStageTabId === 'media' ? 'visible' : 'hidden'}><WorkplaceMediaWorkspace client={serviceClient} appearance={resolvedTheme} onOpenModels={() => openSettingsWorkspace('local-ai')}/></Activity>}
        {stage.surfaces.some((surface) => surface.id === 'today') && <Activity mode={!welcomeSelected && activeStageTabId === 'today' ? 'visible' : 'hidden'}><TodayBriefing client={serviceClient} provider={providerCatalog.selectedProvider ?? ''} model={providerCatalog.selectedModel ?? ''} providers={providerCatalog.providers} onSaveNote={saveEdition} onOpenCalendar={(date) => openWorkspaceSurface('calendar', date)} onOpenSettings={() => openSettingsWorkspace('today')}/></Activity>}
        {stage.surfaces.some((surface) => surface.id === 'calendar') && <Activity mode={!welcomeSelected && activeStageTabId === 'calendar' ? 'visible' : 'hidden'}><CalendarWorkspace client={serviceClient} appearance={resolvedTheme} initialDate={selectedCalendarDate}/></Activity>}
        {stage.surfaces.some((surface) => surface.id === 'search') && <Activity mode={!welcomeSelected && activeStageTabId === 'search' ? 'visible' : 'hidden'}><WorkspaceSearch files={files} notes={Object.values(richBuffers)} chats={chat.summaries} onOpenFile={(file) => void openFile(file)} onOpenNote={(id) => { void openNoteById(id); }} onOpenChat={(id) => { setRightMode('chat'); void chat.open(id); if (!chatOpen) toggleChat(); }}/></Activity>}
        {welcomeSelected ? <div className="welcome"><div className="collection-dashboard__watermark welcome-watermark" aria-hidden="true"><span className="collection-dashboard__watermark-spin"><span className="collection-dashboard__watermark-mark" /></span></div><h2 className="workspace-welcome-title">Welcome</h2><div className="welcome-actions"><Button onClick={() => void explorerControls.current?.createProgram()}>New program</Button><Button variant="ghost" onPress={() => void createRichNote()}>New note</Button></div><WelcomeIdeas onOpen={(id) => { if (id === 'market') setMarketCategory('all'); if (id === 'apps') { focusAppsWorkspace(); return; } openWorkspaceSurface(id); }}/></div> : activeStageTabId === 'programs' ? null : activeStageTabId === 'arcade' ? null : activeStageTabId === 'code' ? null : activeStageTabId === 'fellowship' ? null : activeStageTabId === 'craft' ? null : activeStageTabId === 'prompts' ? null : activeStageTabId === 'apps' ? null : activeStageTabId === 'glossary' ? null : activeStageTabId === 'teams' ? null : activeStageTabId === 'market' ? null : activeStageTabId === 'media' ? null : activeStageTabId === 'today' ? null : activeStageTabId === 'calendar' ? null : activeStageTabId === 'search' ? null : activeStageTabId === 'settings' || activeStageTabId === 'methods' ? (
            <SettingsWorkspace
              craftScopeId={researchScopeId}
              key={`settings-${activeStageTabId === 'methods' ? 'preset' : settingsSection}`}
              initialSection={activeStageTabId === 'methods' ? 'preset' : settingsSection}
              initialAction={settingsAction}
              onInitialActionHandled={() => setSettingsAction(undefined)}
              initialScheduleDate={selectedCalendarDate}
              rootName={rootName}
              authorized={authorized}
              authorizingUi={false}
              onAuthorize={() => openSettingsWorkspace('data')}
              onLocalFoldersChanged={localFoldersChanged}
              onOpenPrograms={openPrograms}
              onWorkspaceCleared={workspaceCleared}
              onWorkspaceImported={workspaceImported}
              theme={themeChoice}
              onThemeChange={setThemeChoice}
              methods={methods}
              attachedIds={attachedMethodIds}
              onToggleAttach={toggleAttachedMethod}
              collections={knowledge.collections}
              knowledge={knowledge}
              embeddingModels={providerCatalog.providers.flatMap((provider) => provider.modelFacts?.filter((model) => model.roles.includes('embedding') || model.roles.includes('rerank')).map((model) => ({ value: `${provider.id}:${model.modelId}`, label: model.modelId, roles: model.roles })) ?? [])}
              todayModels={providerCatalog.providers.filter((provider) => provider.id !== 'local-replay' || providerCatalog.demo).flatMap((provider) => provider.models.filter((model) => { const roles = provider.modelFacts?.find((item) => item.modelId === model)?.roles; return !roles || roles.includes('chat'); }).map((model) => ({ providerId: provider.id, modelId: model, label: `${provider.name ?? provider.id} · ${model}`, hidden: modelVisibility.hidden.includes(`${provider.id}:${model}`) }))).sort((a, b) => Number(modelVisibility.pinned.includes(`${b.providerId}:${b.modelId}`)) - Number(modelVisibility.pinned.includes(`${a.providerId}:${a.modelId}`)) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }))}
              onOpenModels={openModelMarket}
              onWorkspaceDefaultsChanged={() => { void providerCatalog.refresh(); window.dispatchEvent(new Event('office-models-changed')); }}
              onUseLocalModel={(model) => { selectChatModel(`managed-local:${model}`); setRightMode('chat'); if (!chatOpen) toggleChat(); }}
              onOpenMedia={() => openWorkspaceSurface('media')}
              onOpenApps={() => openWorkspaceSurface('apps')}
            />
          )
          : activeSurface?.kind === 'knowledge-source' ? <KnowledgeSourceView versionId={activeSurface.fileId.slice(7)} client={serviceClient}/>
          : activeSurface?.kind === 'file-preview' && previewTarget ? <ExternalFilePreview target={previewTarget} client={serviceClient} name={activeSurface.title}/>
          : richDocumentActive && activeStageTabId && activeRichDocument ? (
            <>
              {projectionConflictOpen ? <NoteProjectionConflict
                drift={noteProjection.drift}
                editorDirty={richDirty}
                busy={noteProjection.busy}
                error={noteProjection.error}
                onApply={() => { void noteProjection.apply().then((result) => { if (result && validateRichDocument(result.document)) { const document = result.document as RichDocument; saveRichBuffers({ ...richBuffersRef.current, [document.id]: document }); localStorage.removeItem(`${draftKey(document.id)}:rich`); setProjectionConflictOpen(false); } }); }}
                onDiscard={() => { void noteProjection.discard().then((document) => { if (document && validateRichDocument(document)) saveRichBuffers({ ...richBuffersRef.current, [document.id]: document as RichDocument }); setProjectionConflictOpen(false); }); }}
                onKeepEditor={() => { void keepEditorProjection(activeStageTabId); }}
                onKeepMarkdown={() => { void keepMarkdownProjection(activeStageTabId); }}
                onCancel={() => setProjectionConflictOpen(false)}
              /> : null}
              <Suspense fallback={null}><RichDocumentEditorView
              key={activeStageTabId}
              document={activeRichDocument}
              onSave={saveActiveDocument}
              dirty={richDirty}
              theme={resolvedTheme}
              onChange={(next) => updateRichContent(activeStageTabId, next)}
              onAttach={(file, insert) => attachToRichDocument(activeStageTabId, file, insert)}
              onExport={(format) => exportNote(activeStageTabId, format)}
              onSourceMode={() => setRichSourceMode((mode) => !mode)}
              sourceMode={richSourceMode}
              onSourceChange={(source) => updateRichSource(activeStageTabId, source)}
              onSelectionChange={(selected) => setSelection(selected)}
              editorRef={activeEditorRef}
              onPromptAI={(prompt, selected) => void handleDocumentAIPrompt(prompt, selected)}
              activeProposal={proposal}
              isProposalStale={Boolean(proposal && isProposalStale(proposal, activeRichDocument))}
              onAcceptProposal={applyProposal}
              onRejectProposal={() => setProposal(null)}
              onCancelProposal={() => setProposal(null)}
            /></Suspense>
            </>
          )
          : active && isMarkdownFile(active.name) && fileRichDocument ? (
            <Suspense fallback={null}><RichDocumentEditorView
              key={active.id}
              document={fileRichDocument}
              seedMarkdown={content}
              onSave={saveActiveDocument}
              dirty={dirty}
              theme={resolvedTheme}
              onChange={(nextBlocks, markdown) => updateFileRichContent(active.id, nextBlocks, markdown)}
              onAttach={(file, insert) => attachToRichDocument(active.id, file, insert)}
              onExport={(format) => exportNote(active.id, format)}
              onSourceMode={() => toggleFileSourceMode(active.id)}
              sourceMode={fileSourceMode[active.id] ?? false}
              sourceValue={content}
              onSourceDraftChange={(source) => setContent(source)}
              onSourceChange={(source) => setContent(source)}
              onSelectionChange={(selected) => setSelection(selected)}
              editorRef={activeEditorRef}
              onPromptAI={(prompt, selected) => void handleDocumentAIPrompt(prompt, selected)}
              activeProposal={proposal}
              isProposalStale={Boolean(proposal && isProposalStale(proposal, fileRichDocument))}
              onAcceptProposal={applyProposal}
              onRejectProposal={() => setProposal(null)}
              onCancelProposal={() => setProposal(null)}
            /></Suspense>
          )
          : activeStageTabId && openingFileIds.has(activeStageTabId) ? <div className="welcome" role="status"><p>Opening file…</p></div>
          : active ? <>{fileConflict === active.id && <div className="document-conflict" role="alert"><span>This file changed outside AIR Office. Your edits are preserved in a recovery draft.</span><Button size="sm" variant="secondary" onPress={() => void reloadConflictedFile()}>Load latest file</Button></div>}<div className="source-editor-stage"><SourceEditor fileId={active.id} name={active.name} content={content} readOnly={!ready} theme={resolvedTheme} onChange={setContent} onSelectionChange={setSelection} onSave={saveActiveDocument}/></div></>
          : inStageChat ? null
          : <div className="welcome"><div className="collection-dashboard__watermark welcome-watermark" aria-hidden="true"><span className="collection-dashboard__watermark-spin"><span className="collection-dashboard__watermark-mark" /></span></div><h2 className="workspace-welcome-title">Welcome</h2><div className="welcome-actions"><Button onClick={() => void explorerControls.current?.createProgram()}>New program</Button><Button variant="ghost" onPress={() => void createRichNote()}>New note</Button></div><WelcomeIdeas onOpen={(id) => { if (id === 'market') setMarketCategory('all'); if (id === 'apps') { focusAppsWorkspace(); return; } openWorkspaceSurface(id); }}/></div>}
        </div>
      </GlassContent>
      <StageScrollbar scrollerId="stage-panel" />
      {/* Library-player pattern: stage chrome lives in this scene over real stage
          content (no flat --surface-stage sample), so Regular shades match the card. */}
      <div className="stage-top">
        <div className="top-left">
          {!stageExpanded && !filesOpen && (
          <div className="brand-corner">
            <GlassToolbar className="brand-toolbar" aria-label="AIR Office" material="regular" appearance={resolvedTheme}>
              <GlassMenu>
                <GlassToolbarButton className="brand-button" size="icon" aria-label="AIR Office" render={<GlassMenuTrigger />}>
                  <img src={publicAsset('air_logo_vector.svg')} alt="" width={30} height={30}/>
                </GlassToolbarButton>
                <GlassMenuContent className="workspace-menu ui-frost" align="start" material="regular" morph="detach">
                  <GlassMenuItem onClick={() => void createRichNote()}><IconEdit/>New note</GlassMenuItem>
                  <GlassMenuItem onClick={() => openPrograms()}><IconFolder/>Add a folder to a program</GlassMenuItem>
                  <GlassMenuSeparator/>
                  <GlassMenuItem disabled={chat.sending} onClick={() => { chat.newConversation(); if (!chatOpen) toggleChat(); }}><HugeiconsIcon icon={AiChat02Icon} size={16}/>New chat</GlassMenuItem>
                  <GlassMenuItem onClick={() => void explorerControls.current?.createProgram()}><IconFolder/>New program</GlassMenuItem>
                </GlassMenuContent>
              </GlassMenu>
            </GlassToolbar>
          </div>
          )}
          <GlassToolbar className="rail-toolbar" aria-label="Workspace rails" material="regular" appearance={resolvedTheme} radius={19}>
            <ChromeTooltip label={filesOpen ? 'Collapse files' : 'Show files'} placement="bottom">
              <GlassToolbarButton className="rail-toggle" size="icon" onClick={toggleFiles} aria-label={filesOpen ? 'Collapse files' : 'Show files'} aria-pressed={filesOpen}><IconPanelLeft/></GlassToolbarButton>
            </ChromeTooltip>
          </GlassToolbar>
          <div className="code-folder-host" />
          {canSaveDocument && !richDocumentActive && !(active && isMarkdownFile(active.name)) && (
            <GlassToolbar className="document-save-row" aria-label="Document save" material="regular" appearance={resolvedTheme} radius={19}>
              <ChromeTooltip label={dirty ? 'Save' : 'Saved'} placement="bottom" wrapDisabled={!dirty}>
                <GlassButton className="document-save-button" size="icon" material="regular" appearance={resolvedTheme} aria-label={dirty ? 'Save document' : 'Document saved'} onClick={saveActiveDocument} disabled={!dirty}><IconSave/></GlassButton>
              </ChromeTooltip>
            </GlassToolbar>
          )}
        </div>
        <div className="document-player-stack">
          <div className="document-player-shell">
            <GlassSurface className="document-player" material="regular" appearance={resolvedTheme} radius="capsule" interactive role="toolbar" aria-label="Workspace navigation">
              <div className="document-player-history">
                <ChromeTooltip label="Go back" placement="bottom" wrapDisabled={navigation.back.length === 0}>
                  <button type="button" className="document-player-step" aria-label="Go back" disabled={navigation.back.length === 0} onClick={() => navigateWorkspace('back')}><IconChevronLeft/></button>
                </ChromeTooltip>
                <ChromeTooltip label="Go forward" placement="bottom" wrapDisabled={navigation.forward.length === 0}>
                  <button type="button" className="document-player-step" aria-label="Go forward" disabled={navigation.forward.length === 0} onClick={() => navigateWorkspace('forward')}><IconChevronRight/></button>
                </ChromeTooltip>
              </div>
              <div className="document-player-heading">
                {(activeSurface?.kind === 'document' || activeSurface?.kind === 'rich-document' || activeSurface?.kind === 'file-preview') && <span className="document-player-icon"><IconFile/></span>}
                <ChromeTooltip label={documentTitle} placement="bottom">
                  <h1 className={`document-player-title${showingClockTitle ? ' document-player-title--clock' : ''}`}>{documentTitle}</h1>
                </ChromeTooltip>
              </div>
              <div className="document-player-nav">
                {activeSurface?.kind === 'programs' || activeSurface?.kind === 'today' || activeSurface?.kind === 'search' || activeSurface?.kind === 'teams' || activeSurface?.kind === 'market' || activeSurface?.kind === 'arcade' || activeSurface?.kind === 'code' || activeSurface?.kind === 'fellowship' || activeSurface?.kind === 'craft' || activeSurface?.kind === 'media' || activeSurface?.kind === 'apps' || activeSurface?.kind === 'glossary' || activeSurface?.kind === 'prompts' ? (
                  <ChromeTooltip label={'Close ' + activeSurface.title} placement="bottom">
                    <button type="button" className="document-player-step" aria-label={'Close ' + activeSurface.title} onClick={() => closeWorkspaceView(activeSurface.id)}><IconClose/></button>
                  </ChromeTooltip>
                ) : activeSurface?.kind === 'calendar' ? (
                  <ChromeTooltip label="Close Calendar" placement="bottom">
                    <button type="button" className="document-player-step" aria-label="Close Calendar" onClick={() => closeWorkspaceView('calendar')}><IconClose/></button>
                  </ChromeTooltip>
                ) : activeSurface?.kind === 'settings' || activeSurface?.kind === 'methods' ? (
                  <ChromeTooltip label="Close settings" placement="bottom">
                    <button type="button" className="document-player-step" aria-label="Close settings" onClick={closeSettingsWorkspace}><IconClose/></button>
                  </ChromeTooltip>
                ) : null}
                <ChromeTooltip label={stageExpanded ? 'Restore side panels' : 'Expand stage'} placement="bottom">
                  <button type="button" className="document-player-step" aria-label={stageExpanded ? 'Restore side panels' : 'Expand stage'} aria-pressed={stageExpanded} onClick={toggleStageExpanded}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={stageExpanded ? 'M9 3v6H3m12-6v6h6M3 15h6v6m12-6h-6v6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'}/></svg></button>
                </ChromeTooltip>
              </div>
            </GlassSurface>
          </div>
          <div className="document-top-dock" aria-label="Document editing controls" />
        </div>
        <div className="top-right">
          <GlassToolbar className="rail-toolbar" aria-label="Workspace rails" material="regular" appearance={resolvedTheme} radius={19}>
            <ChromeTooltip label={chatOpen ? 'Collapse assistant' : 'Show assistant'} placement="bottom">
              <GlassToolbarButton className="rail-toggle" size="icon" onClick={toggleChat} aria-label={chatOpen ? 'Collapse assistant' : 'Show assistant'} aria-pressed={chatOpen}><IconPanelRight/></GlassToolbarButton>
            </ChromeTooltip>
          </GlassToolbar>
          {!stageExpanded && !chatOpen && (
          <div className="profile-corner">
            <StageProfileMenu appearance={resolvedTheme} onTheme={setThemeChoice} onSettings={() => openSettingsWorkspace('dashboard')}/>
          </div>
          )}
        </div>
      </div>
      <div className={inStageChat ? 'stage-bottom stage-bottom--chat' : 'stage-bottom'}>
        <div className="bottom-dock" />
      </div>
    </GlassScene>
    {welcomeSelected && <div className="welcome-gradient-border" aria-hidden="true" />}
    </div>

    {canResize && chatOpen && <div className="resize-handle resize-right" onPointerDown={(event) => startDrag('right', event)} onDoubleClick={() => resetRailToDefault('right')} role="separator" tabIndex={0} aria-orientation="vertical" aria-label="Resize assistant panel" aria-valuemin={RIGHT_MIN} aria-valuemax={RIGHT_MAX} aria-valuenow={rightSize} onKeyDown={(event) => resizeRailWithKey('right', event)}/>}

    <aside className="rail rail-right" aria-hidden={!chatOpen} inert={!chatOpen}>
      <div className="rail-right-scene">
        <SidebarNavigation hostScene side="right" mode={rightMode} appearance={resolvedTheme} theme={themeChoice} onTheme={setThemeChoice} onMode={(mode) => { if (mode === 'directory' || mode === 'chat') { if (mode === 'chat' && stageRef.current.activeId === 'chat-stage') updateStage(closeStageSurface(stageRef.current, 'chat-stage')); setRightMode(mode); } }} onSettings={() => openSettingsWorkspace('dashboard')} profileAccessory={<LocalAiPower client={serviceClient} presentation="menu"/>} modeActionsHostRef={setChatHeaderHost} modeActionsVisible={rightMode === 'chat'} leadingAccessory={compact && chatOpen ? (
          <GlassScene className="workspace-action-scene sidebar-rail-toggle-scene" appearance={resolvedTheme} material="regular" maxSurfaces={1}>
            <GlassContent className="workspace-action-material sidebar-switch-material" aria-hidden="true"/>
            <GlassToolbar className="rail-toolbar" aria-label="Workspace rails" material="regular" appearance={resolvedTheme} radius={19}>
              <ChromeTooltip label="Back to document" placement="bottom">
                <GlassToolbarButton className="rail-toggle" size="icon" onClick={toggleChat} aria-label="Collapse assistant" aria-pressed={chatOpen}><IconPanelRight/></GlassToolbarButton>
              </ChromeTooltip>
            </GlassToolbar>
          </GlassScene>
        ) : undefined}/>
        <GlassForeground className="rail-right-body">
          {rightMode === 'directory' && <AssistantDirectory client={conversationClient} chats={chat.summaries} agents={agents} activeId={chat.conversationId} appearance={resolvedTheme} sending={chat.sending} onTeams={() => openWorkspaceSurface('teams')} onMarket={() => openWorkspaceSurface('market')} onOpen={showChat} onOpenStage={openChatStage} onChatAction={async (id, action, confirmed) => {
            const summary = chat.summaries.find((item) => item.id === id);
            if (!summary) throw new Error('This chat is unavailable.');
            if (action === 'stage') { openChatStage(id); return; }
            if (action === 'pin') await conversationClient.update(id, { pinned: !summary.pinned });
            else if (action === 'archive') await conversationClient.update(id, { archived: !summary.archivedAt });
            else if (action === 'unread') await conversationClient.update(id, { unreadAt: new Date().toISOString() });
            else if (action === 'clone') await chat.clone(id);
            else if (action === 'tags') await manageChatTags(id, summary.tags);
            else await deleteChatRequest(id, confirmed);
          }} onNew={() => showChat()} onChanged={chat.refresh}/>}
          <div className="rail-chat-host" ref={setRailChatHost} hidden={rightMode !== 'chat'}>
          {providerCatalog.error && <div className="provider-note" role="status">Provider unavailable: {providerCatalog.error}</div>}

          </div>
        </GlassForeground>
        <FrostScrim className="shell-bottom-frost"/>
        <div id="rail-right-dock" className="rail-right-dock" ref={chatDockHost}/>
        {rightMode === 'chat' && <StageScrollbar scrollerId="rail-right-chat-scroll" top="var(--rail-nav-height)" bottom="calc(var(--chat-composer-height, 160px) + 8px)"/>}
      </div>
    </aside>

    <GlassContent className="app-shell-ambient" aria-hidden="true">
      <LineWaves
        color1="#b8e2ff"
        color2="#47b9ff"
        color3="#23936e"
        speed={0}
        lineCount={72}
        lineWidth={1.3}
        highlight={1}
        warpIntensity={1}
        rotation={-115}
        enableMouseInteraction={false}
        clickRipple={false}
        colorCycleSpeed={0}
        glow={0.5}
        intro={false}
        opacity={0.4}
      />
    </GlassContent>
    {createPortal(chatRail, chatPortalHost)}
  </GlassScene>
);
}



