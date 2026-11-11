import { KnowledgeEmbeddingSettings } from '../knowledge/knowledge-embedding-settings.component';
import { presentKnowledgeIndexJobs } from '../knowledge/knowledge-index-jobs.policy';
import type { Job } from '@office/contracts/job';
import { KnowledgeCollectionsSettings } from './knowledge-collections-settings.component';
import { DocumentPythonSettings } from './document-python-settings.component';
import { KnowledgeFeedsSettings } from '../knowledge/knowledge-feeds-settings.component';
import { MarketSettings } from '../market/market-settings.component';
import type { KnowledgeWorkspaceState } from '../knowledge/knowledge-workspace.hook';
import { ReferencesWorkspace } from '../market/references-workspace.component';
import { ModelsWorkspace } from '../models/models-workspace.component';
import { SelectField } from '../shared/select-field.component';
import { Alert, Card, Separator } from '@heroui/react';
import { DashboardCatalog, DashboardViews, WorkspaceDashboard } from '../shared/collection-dashboard.component';
import { WorkspaceDestinationIcon } from '../app/workspace-destination-icon.component';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MethodsWorkspaceState } from '../market/methods-workspace.hook';
import { MethodsWorkspace } from '../market/methods-workspace.component';
import { ToolsWorkspace } from '../tools/tools-workspace.component';
import { AutomationsWorkspace } from '../calendar/automations-workspace.component';
import { CalendarImport } from '../calendar/calendar-import.component';
import { clearBrowserWorkspaceContent, switchBrowserWorkspaceContent } from '../app/workspace-reset.policy';
import { LocalFoldersSettings } from './local-folders-settings.component';
import { StorageLocationSettings } from './storage-location-settings.component';
import { CacheManagement } from './cache-management.component';
import { AppsSettingsSection } from '../market/apps-settings.component';
import { CraftSettings } from './craft-settings.component';
import { DashboardSettingsSection, type DocumentScaleChoice, type InterfaceScaleChoice } from './dashboard-settings.component';
import { readDocumentScaleChoice, readInterfaceScaleChoice } from './display-scale.policy';
import {
  FLAT_MATERIALS_SETTING,
  applyFlatMaterials,
  effectiveFlatMaterialsEnabled,
  notifyFlatMaterialsChanged,
} from './flat-materials.policy';
import { QuickStartSettings } from './quick-start-settings.component';
import { ProfileSettingsSection } from './profile-settings.component';
import { TodaySettingsSection } from './today-settings.component';
import { demoModeAvailable, demoModeRequested, ensureDemoServiceReachable } from '../shared/service-endpoint.hook';
import { createServiceClient } from '../shared/service-client.hook';
import type { ImportReport, WorkspaceBundle } from '@office/contracts/export';
import { MAX_BUNDLE_BYTES } from '@office/contracts/export';
import {
  formatFlagValue,
  flagOptionLabel,
  parseFlagValue,
  resolveFlagState,
  searchSettingsFlags,
  settingsFlags,
  settingsSectionIcons,
  settingsSections,
  type SettingsFlag,
  type SettingsFlagScope,
  type SettingsSection,
} from './settings.policy';
import { INSTANCE_SETTINGS_KEY, PERSONAL_SETTINGS_KEY, clearSettingsValue, readSettingsValues, setSettingsValue } from './settings.store';
import { Button, Input, SearchField, Switch } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { AiCloudIcon, DatabaseIcon, Delete02Icon, Download01Icon, LaptopIcon, News01Icon, Search01Icon, SlidersHorizontalIcon, Upload01Icon, User02Icon } from '@hugeicons/core-free-icons';

export type { SettingsSection } from './settings.policy';

const settingsIntroNotices: Partial<Record<SettingsSection, { title: string; description: string }>> = {
  data: {
    title: 'Privacy and exports',
    description: 'Notes, chats, and files you import stay on this computer. A cloud model receives the prompt and the material included in that request. Exports leave out keys and downloaded models.',
  },
  automations: {
    title: 'Schedule availability',
    description: 'AIR Office’s service must be running at the scheduled time. Choose below what happens after downtime.',
  },
};

type ThemeChoice = 'light' | 'dark' | 'system';

type Props = {
  craftScopeId?: string;
  initialSection?: SettingsSection;
  initialAction?: 'create';
  onInitialActionHandled?: () => void;
  initialScheduleDate?: string;
  rootName: string;
  authorized: boolean;
  authorizingUi: boolean;
  onAuthorize: () => void;
  onLocalFoldersChanged?: () => Promise<void>;
  onOpenPrograms?: (scopeId?: string) => void;
  onWorkspaceCleared?: () => Promise<void>;
  onWorkspaceImported?: () => Promise<void>;
  theme?: ThemeChoice;
  onThemeChange?: (choice: ThemeChoice) => void;
  methods: MethodsWorkspaceState;
  attachedIds: string[];
  onToggleAttach: (id: string) => void;
  collections: { id: string; name: string }[];
  onOpenApps?: () => void;
  onOpenModels?: () => void;
  onUseLocalModel?: (model: string) => void;
  onOpenMedia?: () => void;
  onSectionChange?: (section: SettingsSection, label: string) => void;
  knowledge?: KnowledgeWorkspaceState;
  embeddingModels?: { value: string; label: string; roles?: string[] }[];
  todayModels?: { providerId: string; modelId: string; label: string; hidden?: boolean }[];
  /** Called after the workspace defaults change, so the chat selection follows. */
  onWorkspaceDefaultsChanged?: () => void;
};

const sectionIcons = settingsSectionIcons;

function KnowledgeIndexJobList({ jobs, onCancel }: { jobs: readonly Job[]; onCancel: (id: string) => void }) {
  const rows = useMemo(() => presentKnowledgeIndexJobs(jobs), [jobs]);
  if (rows.length === 0) return null;
  return (
    <ul className="model-job-list" aria-label="Index jobs">
      {rows.map((row) => (
        <li key={row.key}>
          <span>
            {row.label} · {row.stateLabel}{row.count > 1 ? ` · ${row.count}×` : ''}
          </span>
          {row.error && <span className="settings-pref-help" role="status">{row.error}</span>}
          {row.cancellable && (
            <Button variant="tertiary" size="sm" onPress={() => onCancel(row.job.id)}>
              Cancel
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Preferences stage with searchable sidebar location and plain controls. */
export function SettingsWorkspace({
  craftScopeId,
  initialSection = 'dashboard',
  initialAction,
  onInitialActionHandled,
  initialScheduleDate,
  onLocalFoldersChanged,
  onOpenPrograms,
  onWorkspaceCleared,
  onWorkspaceImported,
  theme = 'system',
  onThemeChange,
  methods,
  attachedIds,
  onToggleAttach,
  collections,
  onOpenApps,
  onOpenModels,
  onUseLocalModel,
  onOpenMedia,
  onSectionChange,
  knowledge,
  embeddingModels = [],
  todayModels = [],
  onWorkspaceDefaultsChanged,
}: Props) {
  const navigate = useNavigate();
  const [creationSection, setCreationSection] = useState(initialAction === 'create' ? initialSection : null);
  useEffect(() => {
    if (initialAction) {
      setCreationSection(initialSection);
      onInitialActionHandled?.();
    }
  }, [initialAction, initialSection, onInitialActionHandled]);
  const [section, setSection] = useState<SettingsSection>(initialSection === 'market' ? 'skill' : initialSection);
  const [flagQuery, setFlagQuery] = useState('');
  const [personal, setPersonal] = useState<Record<string, unknown>>(() => readSettingsValues(PERSONAL_SETTINGS_KEY));
  const [instance, setInstance] = useState<Record<string, unknown>>(() => readSettingsValues(INSTANCE_SETTINGS_KEY));
  const [flagDrafts, setFlagDrafts] = useState<Record<string, string>>({});
  const [flagErrors, setFlagErrors] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState('');
  const [exportError, setExportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState('');
  const [importError, setImportError] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  const [demoEnabled, setDemoEnabled] = useState(() => demoModeRequested());
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState('');
  const demoAvailable = demoModeAvailable();
  const [localFoldersRevision, setLocalFoldersRevision] = useState(0);
  const serviceClient = useMemo(() => createServiceClient(), []);
  const [clearingWorkspace, setClearingWorkspace] = useState(false);
  const [restoringStarters, setRestoringStarters] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');
  const methodsKind = section === 'preset' || section === 'prompt' || section === 'skill' ? section : null;
  const visibleSections = settingsSections;
  const groups = [...new Set(visibleSections.map((entry) => entry.group))];
  const navigationSection: SettingsSection = section === 'local-ai' ? 'cloud-ai' : section === 'automations' ? 'apps' : section === 'market' ? 'skill' : section;
  const active = settingsSections.find((entry) => entry.id === navigationSection) ?? settingsSections[0]!;
  const visibleFlags = searchSettingsFlags(flagQuery);
  // Retrieval lives in the Knowledge section, not only under Advanced, because
  // it decides whether a collection search uses the embedding index at all.
  const retrievalFlags = settingsFlags.filter((flag) => flag.group === 'Knowledge');
  const [sectionQuery, setSectionQuery] = useState('');

  useEffect(() => {
    onSectionChange?.(section, active.label);
  }, [section, active.label, onSectionChange]);

  function scopeKey(scope: SettingsFlagScope) {
    return scope === 'personal' ? PERSONAL_SETTINGS_KEY : INSTANCE_SETTINGS_KEY;
  }
  function applyScope(scope: SettingsFlagScope, next: Record<string, unknown>) {
    if (scope === 'personal') setPersonal(next);
    else setInstance(next);
  }
  function forgetFlag(flag: SettingsFlag) {
    setFlagDrafts((current) => {
      if (!(flag.id in current)) return current;
      const copy = { ...current };
      delete copy[flag.id];
      return copy;
    });
    setFlagErrors((current) => {
      if (!(flag.id in current)) return current;
      const copy = { ...current };
      delete copy[flag.id];
      return copy;
    });
  }
  function commitFlag(scope: SettingsFlagScope, flag: SettingsFlag, value: unknown) {
    const parsed = parseFlagValue(flag, value);
    if (!parsed.ok) {
      setFlagErrors((current) => ({ ...current, [flag.id]: parsed.reason }));
      return;
    }
    applyScope(scope, setSettingsValue(scopeKey(scope), flag.id, parsed.value));
    forgetFlagErrors(flag);
  }
  function forgetFlagErrors(flag: SettingsFlag) {
    setFlagErrors((current) => {
      if (!(flag.id in current)) return current;
      const copy = { ...current };
      delete copy[flag.id];
      return copy;
    });
  }
  function resetFlag(scope: SettingsFlagScope, flag: SettingsFlag) {
    applyScope(scope, clearSettingsValue(scopeKey(scope), flag.id));
    forgetFlag(flag);
  }
  function editFlagNumber(scope: SettingsFlagScope, flag: SettingsFlag, text: string) {
    setFlagDrafts((current) => ({ ...current, [flag.id]: text }));
    if (!text.trim()) {
      forgetFlagErrors(flag);
      return;
    }
    commitFlag(scope, flag, Number(text));
  }

  function flagRow(flag: SettingsFlag, scope: SettingsFlagScope) {
    const state = resolveFlagState(flag, personal, instance);
    const raw = (scope === 'personal' ? personal : instance)[flag.id];
    const parsedStored = raw === undefined ? null : parseFlagValue(flag, raw);
    const storedTyped = parsedStored?.ok ? parsedStored.value : undefined;
    const storedText = raw === undefined ? 'Not set' : `${formatFlagValue(flag, raw)}${parsedStored?.ok ? '' : ' (invalid)'}`;
    const sourceText = state.source === 'personal' ? 'your setting' : state.source === 'instance' ? 'instance default' : 'built-in default';
    const error = flagErrors[flag.id];
    const draft = flagDrafts[flag.id];
    const checked = typeof storedTyped === 'boolean' ? storedTyped : state.effective === true;
    const selectValue = typeof storedTyped === 'string' ? storedTyped : String(state.effective);
    // A field that is not set shows the value that is in effect, so a control
    // never starts empty and the effective default is visible without opening
    // the settings.
    const numberValue = draft ?? (typeof storedTyped === 'number' ? String(storedTyped) : typeof state.effective === 'number' ? String(state.effective) : '');
    return (
      <div className="settings-pref-row" key={flag.id}>
        <div className="settings-pref-copy">
          <span className="settings-pref-label">{flag.label}</span>
          <span className="settings-pref-help">{flag.help}</span>
          <span className="settings-flag-values">
            <span className="settings-flag-id">{flag.id}</span>
            <span>Stored: {storedText}</span>
            <span>
              Effective: {formatFlagValue(flag, state.effective)} ({sourceText})
            </span>
          </span>
          {error && (
            <span className="settings-flag-error" role="alert">
              {error}
            </span>
          )}
        </div>
        <div className="settings-flag-actions">
          {flag.kind === 'boolean' ? (
            <Switch isSelected={checked} aria-label={flag.label} onChange={(value) => commitFlag(scope, flag, value)}>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          ) : flag.kind === 'enum' ? (
            <SelectField
              className="settings-select"
              aria-label={flag.label}
              value={selectValue}
              onValueChange={(selectedValue) => commitFlag(scope, flag, selectedValue)}
            >
              {(flag.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {flagOptionLabel(flag, option)}
                </option>
              ))}
            </SelectField>
          ) : (
            <Input
              type="number"
              aria-label={flag.label}
              min={flag.min}
              max={flag.max}
              step={flag.kind === 'integer' ? 1 : 'any'}
              value={numberValue}
              placeholder={formatFlagValue(flag, state.effective)}
              onChange={(event) => editFlagNumber(scope, flag, event.target.value)}
              onBlur={() => forgetFlag(flag)}
            />
          )}
          <Button variant="tertiary" size="sm" isDisabled={raw === undefined} onPress={() => resetFlag(scope, flag)}>
            Reset
          </Button>
        </div>
      </div>
    );
  }

  function flagList(flags: readonly SettingsFlag[], scopeOf: (flag: SettingsFlag) => SettingsFlagScope) {
    const flagGroups = [...new Set(flags.map((flag) => flag.group))];
    return flagGroups.map((group) => (
      <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} key={group} aria-label={group}>
        <Card.Header><Card.Title className="flex items-center gap-2" render={(props) => <h3 {...props} />}>
          <HugeiconsIcon icon={SlidersHorizontalIcon} size={18} aria-hidden="true" />
          {group}
        </Card.Title></Card.Header><Separator />
        {flags.filter((flag) => flag.group === group).map((flag) => flagRow(flag, scopeOf(flag)))}
      </Card>
    ));
  }

  async function setDemoMode(enabled: boolean) {
    if (!demoAvailable) return;
    setDemoBusy(true);
    setDemoError('');
    try {
      const { desktopInvoke, isDesktopHost } = await import('../entry/desktop-host.adapter');
      if (isDesktopHost()) {
        if (enabled) {
          const endpoint = await desktopInvoke<{ base: string }>('start_demo_service');
          if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint.base)) throw new Error('Demo mode returned an invalid service address.');
          window.__AIR_SERVICE_BASE__ = endpoint.base;
        } else {
          await desktopInvoke('stop_demo_service').catch(() => undefined);
          const normal = await desktopInvoke<{ service_base?: string; serviceBase?: string }>('publish_bootstrap').catch(() => null);
          const base = normal && typeof (normal.service_base ?? normal.serviceBase) === 'string'
            ? String(normal.service_base ?? normal.serviceBase)
            : null;
          if (base && /^http:\/\/127\.0\.0\.1:\d+$/.test(base)) window.__AIR_SERVICE_BASE__ = base;
        }
      } else if (enabled) {
        // Warm the Demo service before the flag is written; ensureServiceReachable
        // would no-op while office.development.demo is still off.
        await ensureDemoServiceReachable();
      }
      switchBrowserWorkspaceContent(enabled);
      setDemoEnabled(enabled);
      window.location.reload();
    } catch (error) {
      setDemoError(error instanceof Error ? error.message : 'Demo mode could not be changed.');
      setDemoBusy(false);
    }
  }

  async function loadSampleContent() {
    setDemoBusy(true);
    setDemoError('');
    try {
      await createServiceClient().json('/api/v1/data/sample', { method: 'POST', body: JSON.stringify({ confirmed: true }) });
      navigate('/', { replace: true });
      window.location.reload();
    } catch (error) {
      setDemoError(error instanceof Error ? error.message : 'Sample research content could not be loaded.');
      setDemoBusy(false);
    }
  }

  async function restoreStarters() {
    if (!window.confirm('Restore the agents, skills, and reference documents that ship with AIR Office? Your notes and chats stay in place.')) return;
    setRestoringStarters(true);
    setWorkspaceNotice('Restoring starter content...');
    setWorkspaceError('');
    try {
      const result = await createServiceClient().json<{
        methodsRestored: number;
        documentsRestored: number;
        documentsPending?: boolean;
        errors: string[];
      }>('/api/v1/data/starters', { method: 'POST', body: JSON.stringify({ confirmed: true }) });
      const documentsText = result.documentsPending
        ? ' Reference documents are being prepared and will appear in Knowledge shortly.'
        : ` Restored ${result.documentsRestored} reference documents.`;
      const restoreError = result.errors.length ? ` ${result.errors.length} items could not be restored.` : '';
      setWorkspaceNotice(`Restored ${result.methodsRestored} agents and skills.${documentsText}${restoreError}`);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Starter content could not be restored.');
      setWorkspaceNotice('');
    } finally {
      setRestoringStarters(false);
    }
  }

  async function clearWorkspace() {
    if (
      !window.confirm(
        'Delete workspace content, imported browser copies and recovery drafts, including conversations, documents, notes, memory, schedules, folder connections, saved tools and provider credentials? The shipped default agents, skills and framework collections are installed again afterwards. Original files in connected folders and downloaded models stay on disk. Export anything you want to keep first.',
      )
    )
      return;
    setClearingWorkspace(true);
    setWorkspaceNotice('Clearing workspace content and browser copies...');
    setWorkspaceError('');
    try {
      const result = await createServiceClient().json<{
        conversationsDeleted: number;
        documentsDeleted: number;
        collectionsDeleted: number;
        notesDeleted: number;
        providerCredentialsRemoved: number;
        defaults?: { methodsRestored: number; documentsRestored: number; documentsPending?: boolean; errors: string[] };
      }>('/api/v1/data/workspace', { method: 'DELETE', body: JSON.stringify({ confirmed: true }) });
      clearBrowserWorkspaceContent(localStorage);
      clearBrowserWorkspaceContent(sessionStorage);
      await onWorkspaceCleared?.();
      setLocalFoldersRevision((value) => value + 1);
      const restored = result.defaults;
      const methodsText = restored ? ` Reinstalled ${restored.methodsRestored} default agents and skills.` : '';
      // The shipped documents are extracted in the background, so they arrive
      // after the answer rather than with it.
      const documentsText = restored?.documentsPending
        ? ' The default framework documents are being prepared and will appear in Knowledge shortly.'
        : restored
          ? ` Reinstalled ${restored.documentsRestored} default documents.`
          : '';
      const restoreError = restored?.errors.length ? ` ${restored.errors.length} default items could not be reinstalled.` : '';
      setWorkspaceNotice(
        `Cleared ${result.conversationsDeleted} conversations, ${result.documentsDeleted} documents, ${result.collectionsDeleted} collections and ${result.notesDeleted} notes.${methodsText}${documentsText}${restoreError}`,
      );
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Workspace clearing did not complete.');
      setWorkspaceNotice('');
    } finally {
      setClearingWorkspace(false);
    }
  }
  async function exportWorkspace() {
    setExporting(true);
    setExportNotice('');
    setExportError('');
    try {
      const bundle = await createServiceClient().json<WorkspaceBundle>('/api/v1/export');
      const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `air-office-workspace-${bundle.manifest.exportId.slice(0, 8)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      const counts = bundle.manifest.counts;
      const missing = bundle.payload.documents.reduce((total, document) => total + document.versions.filter((version) => version.sourceBase64 === null).length, 0);
      const omitted = bundle.payload.omittedSchedules;
      const folders = bundle.payload.disconnectedFolders;
      setExportNotice(`Exported ${counts.conversations} conversations, ${counts.collections} collections, and ${counts.documents} documents.${missing ? ` ${missing} original files were unavailable and could not be included.` : ''}${folders ? ` ${folders} local ${folders === 1 ? 'folder must' : 'folders must'} be reconnected on the destination.` : ''}${omitted ? ` ${omitted} ${omitted === 1 ? 'schedule was' : 'schedules were'} excluded because tool inputs contain credentials.` : ''}`);
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : 'The workspace could not be exported.');
    } finally {
      setExporting(false);
    }
  }

  async function importWorkspace(file: File) {
    setImporting(true);
    setImportNotice('');
    setImportError('');
    try {
      if (file.size > MAX_BUNDLE_BYTES) throw new Error('This workspace file is too large to import.');
      const raw = await file.text();
      const response = await createServiceClient().request('/api/v1/import', { method: 'POST', body: raw });
      const report = (await response.json().catch(() => null)) as ImportReport | null;
      if (!report || typeof report !== 'object' || !('accepted' in report) || !('restored' in report) || !('rejections' in report)) {
        throw new Error(response.ok ? 'The service returned an unexpected import response.' : `Service request failed (${response.status}).`);
      }
      if (!report.accepted) {
        const detail = report.rejections.map((item) => item.message).filter(Boolean).join(' ');
        setImportError(detail || 'The workspace bundle was rejected.');
        return;
      }
      const counts = report.restored;
      const portable = report.portableWork;
      const conflicts = portable?.conflicts.length ?? 0;
      const missing = portable?.missingSources.length ?? 0;
      const folders = portable?.disconnectedFolders ?? 0;
      const paused = portable?.pausedSchedules ?? 0;
      const omitted = portable?.omittedSchedules ?? 0;
      setImportNotice(`Imported ${counts.conversations} conversations, ${counts.collections} collections, ${counts.documents} documents${portable ? `, ${portable.richDocuments} notes, ${portable.methods} definitions, and ${portable.schedules} schedules` : ''}.${conflicts ? ` ${conflicts} items could not be imported without a conflict.` : ''}${missing ? ` ${missing} original files were unavailable in the export.` : ''}${folders ? ` Reconnect ${folders} local ${folders === 1 ? 'folder' : 'folders'} on this device.` : ''}${paused ? ` ${paused} previously active ${paused === 1 ? 'schedule is' : 'schedules are'} off until you enable ${paused === 1 ? 'it' : 'them'}.` : ''}${omitted ? ` ${omitted} ${omitted === 1 ? 'schedule was' : 'schedules were'} excluded because tool inputs contain credentials.` : ''}`);
      await Promise.all([knowledge?.refresh?.(), methods.refresh(), onWorkspaceImported?.()]);
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : 'The workspace could not be imported.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <WorkspaceDashboard
      title="Settings"
      hero={{
        icon: <WorkspaceDestinationIcon name="settings" size={56} />,
        subtitle: 'Make AIR Office work the way you do.',
      }}
    >
      <DashboardViews
        label="Settings groups"
        selectedKey={active.group}
        onSelect={(group) => {
          const first = visibleSections.find((entry) => entry.group === group);
          if (first) {
            setSection(first.id);
            setSectionQuery('');
          }
        }}
        views={groups.map((group) => ({
          id: group,
          label: group,
          actions: null,
          content:
            group === active.group ? (
              <div className="collection-dashboard__columns collection-dashboard__columns--form">
                <DashboardCatalog
                  listLabel="Settings sections"
                  search={{ value: sectionQuery, onChange: setSectionQuery, label: 'Find a settings section', placeholder: 'Find a section…' }}
                  items={visibleSections
                    .filter(
                      (entry) =>
                        (!sectionQuery || (entry.label + ' ' + entry.summary).toLowerCase().includes(sectionQuery.toLowerCase())) &&
                        (sectionQuery || entry.group === active.group),
                    )
                    .map((entry) => ({
                      id: entry.id,
                      title: entry.label,
                      description: '',
                      section: sectionQuery ? entry.group : entry.category,
                      icon: <HugeiconsIcon icon={sectionIcons[entry.id]} size={20} aria-hidden="true" />,
                    }))}
                  selectedId={navigationSection}
                  onSelect={(id) => {
                    const entry = visibleSections.find((entry) => entry.id === id);
                    if (entry) setSection(entry.id);
                  }}
                  emptyDescription="No matching settings sections. Try another search."
                />
                <Card className="collection-dashboard__form gap-3 p-3" role="region" aria-label={active.label + ' settings'}>
                  <main className="settings-main">
                    <Card variant="tertiary" className="settings-section-intro rounded-2xl p-3">
                      <Card.Description>{active.summary}</Card.Description>
                      {settingsIntroNotices[section] && (
                        <Alert status="accent" className="rounded-xl">
                          <Alert.Indicator />
                          <Alert.Content>
                            <Alert.Title>{settingsIntroNotices[section]?.title}</Alert.Title>
                            <Alert.Description>{settingsIntroNotices[section]?.description}</Alert.Description>
                          </Alert.Content>
                        </Alert>
                      )}
                    </Card>
                    {(section === 'apps' || section === 'automations') && <div className="flex gap-2" role="group" aria-label="Actions settings">
                      <Button size="sm" aria-pressed={section === 'apps'} variant={section === 'apps' ? 'primary' : 'secondary'} onPress={() => setSection('apps')}>Actions</Button>
                      <Button size="sm" aria-pressed={section === 'automations'} variant={section === 'automations' ? 'primary' : 'secondary'} onPress={() => setSection('automations')}>Schedules</Button>
                    </div>}
                    {(section === 'local-ai' || section === 'cloud-ai') && <Card variant="secondary" className="rounded-2xl p-3" role="group" aria-label="Models settings">
                      <h3 className="settings-block-heading">Choose where your models run</h3><Separator />
                      <div className="flex flex-wrap gap-2">
                        <Button aria-pressed={section === 'cloud-ai'} variant={section === 'cloud-ai' ? 'primary' : 'secondary'} onPress={() => setSection('cloud-ai')}><HugeiconsIcon icon={AiCloudIcon} size={18} aria-hidden="true" />Cloud AI</Button>
                        <Button aria-pressed={section === 'local-ai'} variant={section === 'local-ai' ? 'primary' : 'secondary'} onPress={() => setSection('local-ai')}><HugeiconsIcon icon={LaptopIcon} size={18} aria-hidden="true" />Local AI</Button>
                      </div>
                    </Card>}
                    {section === 'craft' ? (
                      <CraftSettings scopeId={craftScopeId} startWithCreate={creationSection === 'craft'} onChanged={methods.refresh} onOpenKnowledge={() => setSection('knowledge')} />
                    ) : section === 'apps' ? (
                      <><AppsSettingsSection onOpenApps={onOpenApps} startWithCreate={creationSection === 'apps'} /><MarketSettings kind="automation" /></>
                    ) : section === 'dashboard' ? (
                      <DashboardSettingsSection
                        theme={theme}
                        onThemeChange={onThemeChange}
                        interfaceScale={readInterfaceScaleChoice(personal['appearance.interface-size'])}
                        documentScale={readDocumentScaleChoice(personal['appearance.document-size'])}
                        onInterfaceScaleChange={(scale: InterfaceScaleChoice) => { setPersonal(setSettingsValue(PERSONAL_SETTINGS_KEY, 'appearance.interface-size', scale)); window.dispatchEvent(new Event('office-display-scale-changed')); }}
                        onDocumentScaleChange={(scale: DocumentScaleChoice) => { setPersonal(setSettingsValue(PERSONAL_SETTINGS_KEY, 'appearance.document-size', scale)); window.dispatchEvent(new Event('office-display-scale-changed')); }}
                        liquidGlass={!effectiveFlatMaterialsEnabled(personal[FLAT_MATERIALS_SETTING])}
                        onLiquidGlassChange={(enabled) => {
                          const flat = !enabled;
                          setPersonal({ ...setSettingsValue(PERSONAL_SETTINGS_KEY, FLAT_MATERIALS_SETTING, flat) });
                          applyFlatMaterials(flat);
                          notifyFlatMaterialsChanged();
                        }}
                        onOpenSection={(target) => setSection(target)}
                        quickStart={<QuickStartSettings client={serviceClient} onOpenModels={onOpenModels} onOpenCloudAi={() => setSection('cloud-ai')} onApplied={onWorkspaceDefaultsChanged} />}
                      />
                    ) : section === 'profile' ? (
                      <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Profile settings"><Card.Header><Card.Title className="settings-block-heading" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={User02Icon} size={18} aria-hidden="true" />Profile</Card.Title></Card.Header><Separator /><ProfileSettingsSection /></Card>
                    ) : section === 'today' ? (
                      <><Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Today settings"><Card.Header><Card.Title className="settings-block-heading" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={News01Icon} size={18} aria-hidden="true" />Today</Card.Title></Card.Header><Separator /><TodaySettingsSection models={todayModels} /></Card><LocalFoldersSettings key={localFoldersRevision} onChanged={onLocalFoldersChanged} onOpenPrograms={onOpenPrograms} /></>
                    ) : section === 'knowledge' ? (
                      <section className="settings-group settings-data" aria-label="Knowledge settings">
                        {knowledge ? (
                          <>
                            <KnowledgeCollectionsSettings knowledge={knowledge} />
                            <DocumentPythonSettings client={serviceClient} />
                            <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Embedding model">
                              <Card.Header><Card.Title className="flex items-center gap-2" render={(props) => <h3 {...props} />}>
                                <HugeiconsIcon icon={DatabaseIcon} size={18} aria-hidden="true" />
                                Indexing
                              </Card.Title></Card.Header><Separator />
                              <KnowledgeEmbeddingSettings
                                knowledge={knowledge}
                                models={embeddingModels}
                                onOpenLocalAi={() => (onOpenModels ? onOpenModels() : setSection('local-ai'))}
                              />
                              {knowledge.error && <p role="alert">{knowledge.error}</p>}
                              {knowledge.status && <p role="status">{knowledge.status}</p>}
                              <KnowledgeIndexJobList jobs={knowledge.jobs} onCancel={(id) => void knowledge.cancelJob(id)} />
                            </Card>
                            <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Retrieval">
                              <Card.Header><Card.Title className="flex items-center gap-2" render={(props) => <h3 {...props} />}>
                                <HugeiconsIcon icon={Search01Icon} size={18} aria-hidden="true" />
                                Retrieval
                              </Card.Title></Card.Header><Separator />
                              {retrievalFlags.map((flag) => flagRow(flag, 'instance'))}
                            </Card>
                          </>
                        ) : (
                          <p>Open a workspace to configure collection indexing.</p>
                        )}
                        <KnowledgeFeedsSettings />
                      </section>
                    ) : section === 'references' ? (
                      <ReferencesWorkspace />
                    ) : section === 'local-ai' ? (
                      <ModelsWorkspace key="local" scope="local" onBrowseModels={onOpenModels} onUseModel={onUseLocalModel} onOpenMedia={onOpenMedia} />
                    ) : section === 'cloud-ai' ? (
                      <ModelsWorkspace key="cloud" scope="cloud" />
                    ) : section === 'tools' ? (
                      <ToolsWorkspace />
                    ) : section === 'automations' ? (
                      <div className="settings-schedules">
                        <AutomationsWorkspace initialDate={initialScheduleDate} />
                        <CalendarImport />
                      </div>
                    ) : section === 'data' ? (
                      <section className="settings-group settings-data" aria-label="Data">
                        <StorageLocationSettings />
                        <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Demo mode">
                          <Card.Header><Card.Title className="flex items-center gap-2" render={(props) => <h3 {...props} />}>
                            <HugeiconsIcon icon={LaptopIcon} size={18} aria-hidden="true" />
                            Demo
                          </Card.Title></Card.Header><Separator />
                          <div className="settings-pref-row">
                            <div className="settings-pref-copy">
                              <span className="settings-pref-help">
                                Use a separate Demo workspace with showcase notes, chats, agents, and calendar events for walkthroughs and screenshots. Your Normal workspace stays unchanged under a different profile.
                              </span>
                              {demoError && <span role="alert">{demoError}</span>}
                            </div>
                            <button
                              type="button"
                              className="settings-switch"
                              role="switch"
                              aria-checked={demoEnabled}
                              aria-label="Demo mode"
                              disabled={!demoAvailable || demoBusy}
                              onClick={() => void setDemoMode(!demoEnabled)}
                            >
                              <span className="settings-switch-thumb" />
                            </button>
                          </div>
                          {demoEnabled && (
                            <Button variant="secondary" size="sm" isDisabled={demoBusy} onPress={() => void loadSampleContent()}>
                              Load sample research content
                            </Button>
                          )}
                        </Card>
                        <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Export">
                          <Card.Header><Card.Title className="flex items-center gap-2" render={(props) => <h3 {...props} />}>
                            <HugeiconsIcon icon={Download01Icon} size={18} aria-hidden="true" />
                            Export
                          </Card.Title></Card.Header><Separator />
                          <div className="settings-pref-row">
                            <div className="settings-pref-copy">
                              <span className="settings-pref-help">
                                Chats, notes, definitions, schedules and source documents as JSON. Craft packages, keys and model downloads are separate.
                              </span>
                            </div>
                            <Button variant="secondary" size="sm" isDisabled={exporting || importing} onPress={() => void exportWorkspace()}>
                              <HugeiconsIcon icon={Download01Icon} size={16} aria-hidden="true" />
                              {exporting ? 'Exporting…' : 'Download'}
                            </Button>
                          </div>
                          {exportNotice && (
                            <p className="settings-feedback" role="status">
                              {exportNotice}
                            </p>
                          )}
                          {exportError && (
                            <p className="settings-feedback is-error" role="alert">
                              {exportError}
                            </p>
                          )}
                        </Card>
                        <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Import">
                          <Card.Header><Card.Title className="flex items-center gap-2" render={(props) => <h3 {...props} />}>
                            <HugeiconsIcon icon={Upload01Icon} size={18} aria-hidden="true" />
                            Import
                          </Card.Title></Card.Header><Separator />
                          <div className="settings-pref-row">
                            <div className="settings-pref-copy">
                              <span className="settings-pref-help">
                                Import a workspace JSON export. Existing items are kept when identities conflict.
                              </span>
                            </div>
                            <Button variant="secondary" size="sm" isDisabled={importing || exporting} onPress={() => importInput.current?.click()}>
                              <HugeiconsIcon icon={Upload01Icon} size={16} aria-hidden="true" />
                              {importing ? 'Importing…' : 'Choose file'}
                            </Button>
                            <input
                              ref={importInput}
                              type="file"
                              accept=".json,application/json"
                              hidden
                              aria-label="Import workspace bundle"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = '';
                                if (file) void importWorkspace(file);
                              }}
                            />
                          </div>
                          {importNotice && (
                            <p className="settings-feedback" role="status">
                              {importNotice}
                            </p>
                          )}
                          {importError && (
                            <p className="settings-feedback is-error" role="alert">
                              {importError}
                            </p>
                          )}
                        </Card>
                        <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Temporary files">
                          <Card.Header><Card.Title className="flex items-center gap-2" render={(props) => <h3 {...props} />}>
                            <HugeiconsIcon icon={DatabaseIcon} size={18} aria-hidden="true" />
                            Cache
                          </Card.Title></Card.Header><Separator />
                          <p className="settings-pref-help">Remove temporary processing files while keeping your documents and models.</p>
                          <CacheManagement />
                        </Card>
                        <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Starter content">
                          <Card.Header><Card.Title className="flex items-center gap-2" render={(props) => <h3 {...props} />}>
                            <HugeiconsIcon icon={Download01Icon} size={18} aria-hidden="true" />
                            Starter content
                          </Card.Title></Card.Header><Separator />
                          <p className="settings-pref-help">
                            Reinstall the agents, skills, and reference documents that ship with AIR Office. Notes and chats stay in place.
                          </p>
                          <Button variant="secondary" size="sm" isDisabled={restoringStarters || clearingWorkspace} onPress={() => void restoreStarters()}>
                            <HugeiconsIcon icon={Download01Icon} size={16} aria-hidden="true" />
                            {restoringStarters ? 'Restoring...' : 'Restore starter content'}
                          </Button>
                        </Card>
                        <Card variant="secondary" className="rounded-2xl p-3 settings-data-reset" render={(props) => <section {...props} />} aria-label="Private workspace content">
                          <Card.Header><Card.Title className="flex items-center gap-2" render={(props) => <h3 {...props} />}>
                            <HugeiconsIcon icon={Delete02Icon} size={18} aria-hidden="true" />
                            Reset
                          </Card.Title></Card.Header><Separator />
                          <p className="settings-pref-help">
                            Permanently delete saved content, imported copies, drafts, schedules, connections and keys. Original local files and downloaded
                            models stay on disk. Export anything you want to keep first.
                          </p>
                          <Button variant="danger-soft" size="sm" isDisabled={clearingWorkspace || restoringStarters} onPress={() => void clearWorkspace()}>
                            <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />
                            {clearingWorkspace ? 'Deleting...' : 'Delete all content'}
                          </Button>
                          {workspaceNotice && (
                            <p className="settings-feedback" role="status">
                              {workspaceNotice}
                            </p>
                          )}
                          {workspaceError && (
                            <p className="settings-feedback is-error" role="alert">
                              {workspaceError}
                            </p>
                          )}
                        </Card>
                      </section>
                    ) : section === 'advanced' ? (
                      <Fragment>
                        <div className="settings-search">
                          <SearchField
                            fullWidth
                            aria-label="Search advanced settings"
                            value={flagQuery}
                            onChange={setFlagQuery}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape' && flagQuery) {
                                event.preventDefault();
                                setFlagQuery('');
                              }
                            }}
                          >
                            <SearchField.Group>
                              <SearchField.SearchIcon>
                                <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" />
                              </SearchField.SearchIcon>
                              <SearchField.Input placeholder="Search" />
                              <SearchField.ClearButton />
                            </SearchField.Group>
                          </SearchField>
                        </div>
                        {visibleFlags.length === 0 ? (
                          <p className="p-3 text-sm text-muted">No settings match "{flagQuery.trim()}".</p>
                        ) : (
                          flagList(visibleFlags, (flag) => flag.scope)
                        )}
                        <ModelsWorkspace scope="runtime" />
                      </Fragment>
                    ) : methodsKind ? (
                      <><MethodsWorkspace
                        methods={methods}
                        attachedIds={attachedIds}
                        onToggleAttach={onToggleAttach}
                        collections={collections}
                        kind={methodsKind}
                        startWithCreate={creationSection === methodsKind}
                        onKindChange={(next) => setSection(next)}
                        embedded
                      />{methodsKind === 'skill' && <MarketSettings kind="skill" />}</>
                    ) : null}
                  </main>
                </Card>
              </div>
            ) : null,
        }))}
      />
    </WorkspaceDashboard>
  );
}
