import { useCallback, useEffect, useState } from 'react';
import { GlassScene, GlassContent, GlassSurface, GlassToolbar, GlassToolbarButton, GlassMenu, GlassMenuTrigger, GlassMenuContent, GlassMenuCheckboxItem, GlassMenuItem, GlassMenuSeparator } from '@glass-sdk/liquid-glass';
import { HugeiconsIcon } from '@hugeicons/react';
import { Calendar03Icon, News01Icon, Add01Icon, FavouriteIcon, GridViewIcon, Settings01Icon } from '@hugeicons/core-free-icons';
import type { MethodDefinition } from '@office/methods/domain';
import type { AutomationDefinition } from '@office/automations/domain';
import type { ServiceClient } from '../shared/service-client.hook';
import type { SettingsSection } from '../settings/settings.policy';
import { Avatar, Calendar } from '@heroui/react';
import { IconChevronLeft, IconChevronRight } from './ui-icons.component';
import { MarbleBeamAvatar } from './marble-beam-avatar.component';
import { WorkspaceDestinationIcon } from './workspace-destination-icon.component';

export function AgentAvatar({ name, size = 40, appearance = 'light' }: { name: string; index?: number; size?: number; appearance?: 'light' | 'dark' }) {
  return (
    <Avatar size={size <= 48 ? 'sm' : size <= 72 ? 'md' : 'lg'} className="agent-avatar">
      <Avatar.Fallback>
        <MarbleBeamAvatar name={name} size={size} className="agent-avatar-image"/>
      </Avatar.Fallback>
    </Avatar>
  );
}

export function LauncherHome({ client, agents, appearance, onAgent, onSettings, onFiles, onNote, onToday, onCalendar, onApps, onMarket, onGlossary, onTeams, onPrompts, onMedia, onArcade, onCode, onLibrary, onPrograms, onFellowship, onCraft }: {
  client: ServiceClient; agents: MethodDefinition[]; appearance: 'light' | 'dark';
  onAgent: (id: string) => void; onSettings: (section?: SettingsSection) => void;
  onFiles: () => void; onNote: (title?: string) => void; onToday: () => void;
  onCalendar: (date: string) => void; onApps: (id?: string) => void; onMarket: () => void; onGlossary: () => void; onTeams: () => void; onPrompts: () => void; onMedia: () => void; onArcade: () => void; onCode: () => void; onLibrary: () => void; onPrograms?: () => void; onFellowship: () => void; onCraft: () => void;
}) {
  const [apps, setApps] = useState<{ id: string; name: string; icon?: string; custom?: boolean }[]>([]);
  const [automations, setAutomations] = useState<AutomationDefinition[]>([]);
  const [error, setError] = useState('');
  const [favoriteMenuOpen, setFavoriteMenuOpen] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<string[] | null>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem('air-office:favorite-agents') ?? 'null');
      return Array.isArray(stored) && stored.every((id): id is string => typeof id === 'string') ? stored : null;
    } catch { return null; }
  });
  const refresh = useCallback(async () => {
    try { const [result, catalog] = await Promise.all([client.json<{ automations: AutomationDefinition[] }>('/api/v1/automations'), client.json<{ apps: { id: string; name: string; icon?: string; custom?: boolean }[] }>('/api/v1/lab/apps')]); setAutomations(result.automations); setApps(catalog.apps); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Schedules unavailable.'); }
  }, [client]);
  useEffect(() => { void refresh(); const changed = () => { void refresh(); }; window.addEventListener('office-apps-changed', changed); window.addEventListener('air-office:crafts-changed', changed); return () => { window.removeEventListener('office-apps-changed', changed); window.removeEventListener('air-office:crafts-changed', changed); }; }, [refresh]);
  const chosenIds = (favoriteIds ?? agents.map((agent) => agent.value.id)).filter((id) => agents.some((agent) => agent.value.id === id)).slice(0, 3);
  const favoriteAgents = agents.filter((agent) => chosenIds.includes(agent.value.id));
  function toggleFavorite(id: string, checked: boolean) {
    if (checked && chosenIds.length >= 3) return;
    const next = checked ? [...new Set([...chosenIds, id])] : chosenIds.filter((value) => value !== id);
    localStorage.setItem('air-office:favorite-agents', JSON.stringify(next));
    setFavoriteIds(next);
  }
  /* Host-scene GlassSurface for home widgets; nested GlassScene only for the favorites menu. */
  return (
    <div className="launcher-home">
      <div className="launcher-scroll" id="rail-left-home-scroll">
        <div className="launcher-widgets">
          <div className="launcher-widget-shell launcher-widget-shell--interactive">
            <GlassSurface className="launcher-today launcher-widget launcher-widget-glass launcher-widget-interactive ui-frost" material="regular" appearance={appearance} radius={22} refraction={0} interactive role="button" tabIndex={0} aria-label="Open Today briefing" onClick={onToday}>
              <HugeiconsIcon icon={News01Icon} size={22}/>
              <span className="today-script">Today</span>
              <span>Your daily edition</span>
              <small>A briefing shaped by you</small>
            </GlassSurface>
          </div>
          <div className="launcher-widget-shell launcher-widget-shell--interactive">
            <GlassSurface className="launcher-calendar launcher-widget launcher-widget-glass ui-frost" material="regular" appearance={appearance} radius={22} refraction={0}>
              <Calendar aria-label="Automation calendar" onChange={(date) => { if (date) onCalendar(date.toDate('UTC').toISOString().slice(0, 10)); }} firstDayOfWeek="mon">
                <Calendar.Header>
                  <Calendar.NavButton slot="previous" aria-label="Previous month"><IconChevronLeft/></Calendar.NavButton>
                  <HugeiconsIcon icon={Calendar03Icon} size={12} aria-hidden="true"/>
                  <Calendar.Heading/>
                  <Calendar.NavButton slot="next" aria-label="Next month"><IconChevronRight/></Calendar.NavButton>
                </Calendar.Header>
                <Calendar.Grid weekdayStyle="narrow">
                  <Calendar.GridHeader>{(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
                  <Calendar.GridBody>{(date) => <Calendar.Cell date={date}/>}</Calendar.GridBody>
                </Calendar.Grid>
              </Calendar>
              <button type="button" className="widget-caption" aria-label="Open calendar and schedules" onClick={() => onSettings('automations')}>
                {automations.filter((item) => item.enabled).length} active schedules
              </button>
            </GlassSurface>
          </div>
        </div>

        <GlassSurface className="launcher-agents launcher-widget-panel launcher-widget-glass ui-frost" material="regular" appearance={appearance} radius={22} refraction={0} aria-label="Favorite agents">
          <div className="widget-toolbar">
            <h3><HugeiconsIcon icon={FavouriteIcon} size={14} aria-hidden="true"/>Favorite agents</h3>
            <GlassScene className="workspace-action-scene" appearance={appearance} material="regular" maxSurfaces={8}>
              <GlassContent className="workspace-action-material sidebar-switch-material" aria-hidden="true"/>
              <GlassToolbar className="widget-toolbar-cluster" aria-label="Favorite agents" material="regular" appearance={appearance}>
                <GlassMenu open={favoriteMenuOpen} onOpenChange={setFavoriteMenuOpen}>
                  <GlassToolbarButton size="icon" aria-label="Choose favorite agents" render={<GlassMenuTrigger/>}>
                    <HugeiconsIcon icon={Add01Icon} size={14}/>
                  </GlassToolbarButton>
                  <GlassMenuContent className="workspace-menu ui-frost" material="regular" morph="detach" align="end">
                    {agents.map((agent) => <GlassMenuCheckboxItem key={agent.value.id} checked={chosenIds.includes(agent.value.id)} disabled={!chosenIds.includes(agent.value.id) && chosenIds.length >= 3} onCheckedChange={(checked) => toggleFavorite(agent.value.id, checked)}>{agent.value.name}</GlassMenuCheckboxItem>)}
                    {agents.length > 0 && <GlassMenuSeparator/>}
                    <p className="favorite-limit">Choose up to three favorites.</p>
                    <GlassMenuItem onClick={() => onSettings('preset')}>Manage agents</GlassMenuItem>
                  </GlassMenuContent>
                </GlassMenu>
              </GlassToolbar>
            </GlassScene>
          </div>
          <div className="agent-strip">
            {favoriteAgents.map((agent, index) => (
              <button key={agent.value.id} type="button" onClick={() => onAgent(agent.value.id)} title={agent.value.name}>
                <AgentAvatar size={56} name={agent.value.name} index={index} appearance={appearance}/>
                <span>{agent.value.name}</span>
              </button>
            ))}
            {!favoriteAgents.length && (
              <button type="button" className="agent-add" onClick={() => agents.length ? setFavoriteMenuOpen(true) : onSettings('preset')}>
                <span className="agent-avatar agent-avatar-empty" aria-hidden="true">
                  <HugeiconsIcon icon={Add01Icon} size={18}/>
                </span>
                <span>{agents.length ? 'Choose favorites' : 'Create an agent'}</span>
              </button>
            )}
          </div>
        </GlassSurface>

        <nav className="launcher-apps" aria-label="Workspace apps">
          {([
            { label: 'Calendar', icon: 'calendar', tone: 'calendar', action: () => onCalendar(new Date().toLocaleDateString('en-CA')) },
            { label: 'Notes', icon: 'notes', tone: 'notes', action: () => onPrompts() },
            { label: 'Media', icon: 'media', tone: 'media', action: () => onMedia() },
            { label: 'Programs', icon: 'programs', tone: 'programs', action: () => (onPrograms ?? onLibrary)() },
            { label: 'Teams', icon: 'teams', tone: 'teams', action: () => onTeams() },
            { label: 'Market', icon: 'market', tone: 'market', action: onMarket },
            { label: 'Fellowship', icon: 'fellowship', tone: 'fellowship', action: () => onFellowship() },
            { label: 'Craft', icon: 'craft', tone: 'craft', action: () => onCraft() },
            { label: 'Code', icon: 'code', tone: 'code', action: () => onCode() },
            { label: 'Arcade', icon: 'arcade', tone: 'arcade', action: () => onArcade() },
            { label: 'Guides', icon: 'glossary', tone: 'glossary', action: () => onGlossary() },
            { label: 'Settings', icon: 'settings', tone: 'settings', action: () => onSettings() },
                  ] as const).map((app) => (
            <div key={app.label}>
              <button type="button" className={`launcher-app-icon launcher-app-${app.tone}`} aria-label={app.label} onClick={app.action}>
                <WorkspaceDestinationIcon name={app.icon} size={36}/>
              </button>
              <span>{app.label}</span>
            </div>
          ))}
        </nav>

        <GlassSurface className="launcher-shortcuts launcher-widget-panel launcher-widget-glass ui-frost" material="regular" appearance={appearance} radius={22} refraction={0} aria-label="Actions">
          <div className="widget-toolbar">
            <h3><HugeiconsIcon icon={GridViewIcon} size={14} aria-hidden="true"/>Actions</h3>
            <button type="button" className="launcher-panel-action" onClick={() => onSettings('apps')} aria-label="Manage actions">
              <HugeiconsIcon icon={Add01Icon} size={14}/>
            </button>
          </div>
          <div className="shortcut-grid">
            <button type="button" className="shortcut shortcut-note" onClick={() => onApps()}>
              <span className="shortcut-icon" aria-hidden="true"><HugeiconsIcon icon={GridViewIcon} size={18}/></span><span>All Actions</span>
            </button>
            {apps.filter((app) => !app.custom).slice(0, 5).map((app, index) => (
              <button type="button" key={app.id} className={`shortcut shortcut-${['brief', 'calendar', 'agent', 'files', 'search'][index]}`} onClick={() => onApps(app.id)}>
                <span className="shortcut-icon" aria-hidden="true">{app.icon ?? '✨'}</span><span>{app.name}</span>
              </button>
            ))}
          </div>
          {error && <p className="sidebar-error" role="alert">{error}</p>}
        </GlassSurface>
        <a className="rail-credit" href="http://gyrogovernance.com/" target="_blank" rel="noreferrer">Designed by Gyro Governance Lab</a>
      </div>
    </div>
  );
}
