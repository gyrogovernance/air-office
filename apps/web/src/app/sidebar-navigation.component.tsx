import { GlassButton, GlassScene, GlassMenu, GlassMenuTrigger, GlassMenuContent, GlassMenuItem, GlassMenuSeparator, GlassContent, GlassToolbar, GlassToolbarButton } from '@glass-sdk/liquid-glass';
import { WorkspaceTabs } from '../workspace/workspace-tabs.component';
import { cloneElement, isValidElement, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Home01Icon, Folder01Icon, AiChat02Icon, SmileIcon, UserCircleIcon } from '@hugeicons/core-free-icons';
import { MenuSwitchRow } from '../shared/menu-switch-row.component';
import { publicAsset } from '../static-demo/public-asset';

export type LeftRailMode = 'home' | 'files';
export type RightRailMode = 'directory' | 'chat';

export function SidebarNavigation({ side, mode, appearance, onMode, onWelcome, onSettings, theme: _theme, onTheme, hostScene = false, profileAccessory, leadingAccessory, modeActionsHostRef, modeActionsVisible = false }: {
  side: 'left' | 'right'; mode: LeftRailMode | RightRailMode; appearance: 'light' | 'dark';
  onMode: (mode: LeftRailMode | RightRailMode) => void; onWelcome?: () => void; onSettings: () => void;
  theme: 'light' | 'dark' | 'system'; onTheme: (theme: 'light' | 'dark' | 'system') => void;
  /** When true, the parent rail GlassScene hosts this chrome (body content lives in that scene's GlassContent). */
  hostScene?: boolean;
  /** Optional items rendered inside the profile menu, above appearance and Settings. */
  profileAccessory?: ReactNode;
  /** Optional compact rail toggle. Sits on the inner edge toward the stage:
   * left rail → after the chrome buttons; right rail → before them. */
  leadingAccessory?: ReactNode;
  /** Portal host on the switch row for Library / Chat view triggers and new actions. */
  modeActionsHostRef?: (node: HTMLDivElement | null) => void;
  /** Hide mode actions when the rail switch leaves Library or Chat. */
  modeActionsVisible?: boolean;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const menuAppearance = useRef(appearance);
  const keepProfileOpenUntil = useRef(0);
  if (!profileOpen) menuAppearance.current = appearance;
  function setProfileMenuOpen(open: boolean) {
    if (!open && Date.now() < keepProfileOpenUntil.current) {
      setProfileOpen(true);
      return;
    }
    setProfileOpen(open);
  }
  function keepProfileMenuOpen() {
    keepProfileOpenUntil.current = Date.now() + 400;
    setProfileOpen(true);
  }
  function toggleAppearance(checked: boolean) {
    keepProfileMenuOpen();
    onTheme(checked ? 'dark' : 'light');
  }
  const menuAccessory = isValidElement(profileAccessory)
    ? cloneElement(profileAccessory as ReactElement<{ onMenuInteract?: () => void }>, { onMenuInteract: keepProfileMenuOpen })
    : profileAccessory;
  const items = side === 'left'
    ? [{ value: 'home', label: 'Home', icon: Home01Icon }, { value: 'files', label: 'Library', icon: Folder01Icon }]
    : [{ value: 'directory', label: 'Assistance', icon: SmileIcon }, { value: 'chat', label: 'Chat', icon: AiChat02Icon }];
  const tabs = (
    <WorkspaceTabs
      iconOnly
      tipPlacement="bottom"
      appearance={appearance}
      aria-label={side === 'left' ? 'Workspace view' : 'Assistant view'}
      value={mode}
      onValueChange={(value) => { if (value === 'home' || value === 'files' || value === 'directory' || value === 'chat') onMode(value); }}
      items={items.map((item) => ({ value: item.value, title: item.label, label: <HugeiconsIcon icon={item.icon} size={18}/> }))}
    />
  );
  const brand = (
    <GlassButton
      className="sidebar-brand"
      radius="capsule"
      material="regular"
      appearance={appearance}
      onClick={() => onWelcome?.()}
      aria-label="AIR Office welcome page"
    >
      <img src={publicAsset('air_logo_vector.svg')} width={30} height={30} alt=""/>
    </GlassButton>
  );
  /* Toolbar + toolbar-button trigger is the stable glass menu host; plain GlassButton disappears on open.
     Freeze menu appearance while open so a theme toggle does not remount the popup.
     Menus must live in the host scene (maxSurfaces room); detach keeps the toolbar visible.
     Shell chrome stays free of ui-frost so the SDK Regular optical rim can paint. */
  const profile = (
    <GlassToolbar className="sidebar-profile-toolbar" aria-label="Profile and settings" material="regular" appearance={menuAppearance.current}>
      <GlassMenu open={profileOpen} onOpenChange={setProfileMenuOpen}>
        <GlassToolbarButton
          className="sidebar-profile"
          size="icon"
          aria-label="Profile and settings"
          render={<GlassMenuTrigger />}
        >
          <HugeiconsIcon icon={UserCircleIcon} size={22}/>
        </GlassToolbarButton>
        <GlassMenuContent className="workspace-menu sidebar-menu ui-frost" material="regular" appearance={menuAppearance.current} morph="detach" side="bottom" align="end">
          {menuAccessory}
          <MenuSwitchRow
            label="Appearance"
            ariaLabel="Appearance"
            isSelected={appearance === 'dark'}
            onChange={toggleAppearance}
          />
          <GlassMenuSeparator/>
          <GlassMenuItem onClick={onSettings}>Settings</GlassMenuItem>
        </GlassMenuContent>
      </GlassMenu>
    </GlassToolbar>
  );

  /* Brand/tabs/profile get mini-scenes so Regular optics have a local sample
     plane (same stack as tip bar). Profile keeps maxSurfaces room for the portaled menu.
     Mode names come from the icon-tab hover tips; Files / Threads stay on the row below. */
  const brandNode = side === 'left' ? (
    <GlassScene className="workspace-action-scene sidebar-brand-scene" appearance={appearance} material="regular" maxSurfaces={1}>
      <GlassContent className="workspace-action-material sidebar-switch-material" aria-hidden="true"/>
      {brand}
    </GlassScene>
  ) : null;
  const tabsNode = (
    <GlassScene className="workspace-action-scene sidebar-switch-scene" appearance={appearance} material="regular" maxSurfaces={2}>
      <GlassContent className="workspace-action-material sidebar-switch-material" aria-hidden="true"/>
      {tabs}
    </GlassScene>
  );
  const profileNode = side === 'right' ? (
    <GlassScene className="workspace-action-scene sidebar-profile-scene" appearance={appearance} material="regular" maxSurfaces={8}>
      <GlassContent className="workspace-action-material sidebar-switch-material" aria-hidden="true"/>
      {profile}
    </GlassScene>
  ) : null;
  const modeActionsHost = modeActionsHostRef ? (
    <div
      className={`sidebar-mode-actions sidebar-mode-actions-${side}`}
      ref={modeActionsHostRef}
      hidden={!modeActionsVisible}
    />
  ) : null;

  const body = (
    <div className={`sidebar-navigation-row${modeActionsVisible ? '' : ' sidebar-navigation-row--chrome-only'}`}>
      <div className="sidebar-navigation-chrome">
        {side === 'right' ? leadingAccessory : null}
        {brandNode}
        {tabsNode}
        {profileNode}
        {side === 'left' ? leadingAccessory : null}
      </div>
      {modeActionsHost && modeActionsVisible ? <div className="sidebar-mode-row">{modeActionsHost}</div> : modeActionsHost}
    </div>
  );

  if (hostScene) {
    return <div className={`sidebar-navigation sidebar-navigation-${side}`}>{body}</div>;
  }

  return <GlassScene className={`sidebar-navigation sidebar-navigation-${side}`} appearance={appearance} material="regular" maxSurfaces={side === 'right' ? 8 : 4}>
    <GlassContent className="rail-material" aria-hidden="true"/>
    {body}
  </GlassScene>;
}
