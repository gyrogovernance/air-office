import { SelectField } from '../shared/select-field.component';
import { useCallback, useEffect, useState } from 'react';
import { GlassMenu, GlassMenuTrigger, GlassMenuContent, GlassMenuItem, GlassMenuSeparator, GlassSurface } from '@glass-sdk/liquid-glass';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, MoreHorizontalIcon, AiChat02Icon, Folder01Icon, Search01Icon, UserGroupIcon, ShoppingBag01Icon, CheckmarkCircle02Icon, Delete02Icon, Cancel01Icon } from '@hugeicons/core-free-icons';
import type { ConversationSummary } from '@office/chat/domain';
import type { MethodDefinition } from '@office/methods/domain';
import type { ConversationClient, ConversationFolderRecord } from './conversation-client.adapter';
import { AgentAvatar } from '../app/launcher-home.component';
import { MarbleBeamAvatar } from '../app/marble-beam-avatar.component';
import { useAppDialogs } from '../shared/app-dialogs.component';
import { Avatar, Button, SearchField, ListBox } from '@heroui/react';

export type AssistantDirectoryChatAction = 'pin' | 'archive' | 'unread' | 'clone' | 'tags' | 'delete' | 'stage';

export function AssistantDirectory({ client, chats, agents, activeId, appearance, sending, onTeams, onMarket, onOpen, onOpenStage, onChatAction, onNew, onChanged }: {
  client: ConversationClient; chats: ConversationSummary[]; agents: MethodDefinition[]; activeId: string | null;
  appearance: 'light' | 'dark'; sending: boolean; onTeams: () => void; onMarket: () => void; onOpen: (id: string) => void;
  onOpenStage?: (id: string) => void;
  onChatAction?: (id: string, action: AssistantDirectoryChatAction, confirmed?: boolean) => Promise<void>;
  onNew: () => void; onChanged: () => Promise<unknown>;
}) {
  const dialogs = useAppDialogs();
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<ConversationFolderRecord[]>([]);
  const [group, setGroup] = useState('all');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const refresh = useCallback(async () => { try { setGroups(await client.folders()); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Groups unavailable.'); } }, [client]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function createGroup() {
    const name = await dialogs.prompt({ title: 'New chat group', label: 'Group name', submitLabel: 'Create group' });
    if (!name?.trim()) return;
    setPending(true);
    try { const folder = await client.createFolder({ id: crypto.randomUUID(), name: name.trim() }); await refresh(); setGroup(folder.id); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Group could not be created.'); }
    finally { setPending(false); }
  }
  async function moveChat(id: string, folderId: string | null) {
    setPending(true);
    try { await client.update(id, { folderId }); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Chat could not be moved.'); }
    finally { setPending(false); }
  }
  async function renameChat(chat: ConversationSummary) {
    const title = await dialogs.prompt({ title: 'Rename chat', label: 'Chat title', initialValue: chat.title, submitLabel: 'Save' });
    if (title === null) return;
    const next = title.trim();
    if (!next || next === chat.title) return;
    setPending(true);
    try { await client.update(chat.id, { title: next }); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Chat could not be renamed.'); }
    finally { setPending(false); }
  }
  async function runChatAction(id: string, action: AssistantDirectoryChatAction, confirmed = false) {
    if (action === 'stage') {
      if (onOpenStage) onOpenStage(id);
      else if (onChatAction) await onChatAction(id, 'stage');
      return;
    }
    if (onChatAction) {
      setPending(true);
      try { await onChatAction(id, action, confirmed); await onChanged(); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Chat action could not complete.'); }
      finally { setPending(false); }
      return;
    }
    const chat = chats.find((item) => item.id === id);
    if (!chat) return;
    setPending(true);
    try {
      if (action === 'pin') await client.update(id, { pinned: !chat.pinned });
      else if (action === 'archive') await client.update(id, { archived: !chat.archivedAt });
      else if (action === 'unread') await client.update(id, { unreadAt: new Date().toISOString() });
      else if (action === 'tags') {
        const value = await dialogs.prompt({ title: 'Manage chat tags', label: 'Tags, separated by commas', initialValue: chat.tags.join(', '), submitLabel: 'Save tags' });
        if (value === null) return;
        await client.update(id, { tags: [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))] });
      } else if (action === 'delete') {
        if (!confirmed && !await dialogs.confirm({ title: 'Delete chat?', message: 'This chat will be removed from your history.', confirmLabel: 'Delete', destructive: true })) return;
        await client.remove(id);
      } else return;
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Chat action could not complete.'); }
    finally { setPending(false); }
  }
  function endSelection() { setSelecting(false); setSelected([]); }
  async function deleteSelected() {
    const ids = selected.filter((id) => chats.some((chat) => chat.id === id));
    if (!ids.length) return;
    if (!await dialogs.confirm({ title: `Delete ${ids.length} chat${ids.length === 1 ? '' : 's'}?`, message: 'These chats will be removed from your history.', confirmLabel: 'Delete', destructive: true })) return;
    setPending(true);
    try {
      for (const id of ids) {
        if (onChatAction) await onChatAction(id, 'delete', true);
        else await client.remove(id);
      }
      endSelection();
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Chats could not be deleted.'); }
    finally { setPending(false); }
  }
  const visible = chats.filter((chat) => !chat.archivedAt && (group === 'all' || chat.folderId === group) && `${chat.title} ${chat.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  /* Teams / Market use host-scene glass like the left launcher widgets. */
  return (
    <div className="assistant-directory">
      <div className="launcher-widgets assistance-widgets">
        <div className="launcher-widget-shell launcher-widget-shell--interactive">
          <GlassSurface className="launcher-widget assistance-widget assistance-widget-teams launcher-widget-glass launcher-widget-interactive ui-frost" material="regular" appearance={appearance} radius={22} refraction={0} interactive role="button" tabIndex={0} aria-label="Open Teams" onClick={onTeams}>
            <div className="assistance-team-art" aria-hidden="true">{[1, 2].map((index) => <Avatar key={index} size="lg" className={`assistance-art-avatar assistance-art-avatar-${index}`} aria-hidden="true"><Avatar.Fallback><MarbleBeamAvatar name={agents[index]?.value.name ?? ['Day planner', 'Code reviewer', 'Research guide'][index] ?? 'Team'} size={80}/></Avatar.Fallback></Avatar>)}</div>
            <HugeiconsIcon icon={UserGroupIcon} size={24}/>
            <strong>Teams</strong><span>Your agents</span><small>{agents.length} ready to meet</small>
          </GlassSurface>
        </div>
        <div className="launcher-widget-shell launcher-widget-shell--interactive">
          <GlassSurface className="launcher-widget assistance-widget assistance-widget-market launcher-widget-glass launcher-widget-interactive ui-frost" material="regular" appearance={appearance} radius={22} refraction={0} interactive role="button" tabIndex={0} aria-label="Open Market" onClick={onMarket}>
            <div className="assistance-market-art" aria-hidden="true">
              <span className="assistance-market-chip assistance-market-chip-0">✦</span>
              <span className="assistance-market-chip assistance-market-chip-1">⌘</span>
            </div>
            <HugeiconsIcon icon={ShoppingBag01Icon} size={24}/>
            <strong>Market</strong><span>Made to share</span><small>Prompts, skills &amp; more</small>
          </GlassSurface>
        </div>
      </div>
      <div className="widget-toolbar directory-title">
        <h3>Chats</h3>
        <div className="directory-title-actions">
          <Button variant="secondary" size="sm" isIconOnly isDisabled={sending || !visible.length} onPress={() => selecting ? endSelection() : setSelecting(true)} aria-label={selecting ? 'Cancel selection' : 'Select chats'} aria-pressed={selecting}>
            <HugeiconsIcon icon={selecting ? Cancel01Icon : CheckmarkCircle02Icon} size={16}/>
          </Button>
          <Button variant="secondary" size="sm" isIconOnly isDisabled={sending} onPress={onNew} aria-label="New chat">
            <HugeiconsIcon icon={Add01Icon} size={16}/>
          </Button>
        </div>
      </div>
      {selecting && <div className="directory-selection" role="status">
        <span>{selected.length} selected</span>
        <Button variant="danger-soft" size="sm" isDisabled={pending || !selected.length} onPress={() => void deleteSelected()} aria-label="Delete selected chats"><HugeiconsIcon icon={Delete02Icon} size={14}/>Delete</Button>
        <Button variant="ghost" size="sm" onPress={endSelection}>Cancel</Button>
      </div>}
      <div className="directory-search"><SearchField fullWidth aria-label="Search chats" value={query} onChange={setQuery}><SearchField.Group><SearchField.SearchIcon><HugeiconsIcon icon={Search01Icon} size={16}/></SearchField.SearchIcon><SearchField.Input placeholder="Search chats…" /><SearchField.ClearButton /></SearchField.Group></SearchField></div>
      <div className="directory-groups">
        <SelectField className="directory-group-select" aria-label="Chat group" value={group} onValueChange={(selectedValue) => setGroup(selectedValue)}>
          <option value="all">All chats</option>
          {groups.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </SelectField>
        <Button className="directory-group-create" variant="ghost" size="sm" isIconOnly isDisabled={pending} onPress={() => void createGroup()} aria-label="New chat group">
          <HugeiconsIcon icon={Folder01Icon} size={16}/><HugeiconsIcon icon={Add01Icon} size={12}/>
        </Button>
      </div>
      {error && <div className="sidebar-error" role="alert">{error}<Button className="sidebar-error-retry" variant="ghost" size="sm" onPress={() => void refresh()}>Retry</Button></div>}
      {visible.length > 0 ? (
        <ListBox
          aria-label="Conversations"
          className="directory-chats"
          selectionMode={selecting ? "multiple" : "none"}
          selectedKeys={selecting ? new Set(selected) : undefined}
          onSelectionChange={selecting ? (keys) => setSelected(Array.from(keys) as string[]) : undefined}
          onAction={selecting ? undefined : (key) => onOpen(key as string)}
          disabledKeys={selecting ? undefined : new Set()}
        >
          {visible.map((chat) => (
            <ListBox.Item
              key={chat.id}
              id={chat.id}
              textValue={chat.title}
              className="directory-chat-item"
              data-current={!selecting && chat.id === activeId ? 'true' : undefined}
              isDisabled={false}
            >
              <span className="chat-avatar">
                <AgentAvatar name={chat.title || chat.id} size={36} appearance={appearance}/>
                {chat.unreadAt && <i className="unread-dot"/>}
              </span>
              <div className="directory-chat-copy">
                <span className="directory-chat-title">{chat.title}</span>
                <span className="directory-chat-meta">{chat.pinned ? 'Pinned · ' : ''}{chat.messageCount} messages{chat.folderId ? ` · ${groups.find((item) => item.id === chat.folderId)?.name ?? 'Program'}` : ''}</span>
              </div>
              <time className="directory-chat-time" dateTime={chat.updatedAt}>{new Date(chat.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
              {!selecting && (
                <div
                  className="directory-chat-menu-host"
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => event.stopPropagation()}
                >
                  <GlassMenu>
                    <GlassMenuTrigger className="directory-chat-menu" aria-label={`Options for ${chat.title}`} disabled={pending}>
                      <HugeiconsIcon icon={MoreHorizontalIcon} size={16}/>
                    </GlassMenuTrigger>
                    <GlassMenuContent className="workspace-menu sidebar-menu ui-frost" material="regular" appearance={appearance} morph="detach">
                      {(onOpenStage || onChatAction) && <GlassMenuItem onClick={() => void runChatAction(chat.id, 'stage')}>Open in stage</GlassMenuItem>}
                      <GlassMenuItem onClick={() => void renameChat(chat)}>Rename…</GlassMenuItem>
                      <GlassMenuItem onClick={() => void runChatAction(chat.id, 'pin')}>{chat.pinned ? 'Unpin' : 'Pin'}</GlassMenuItem>
                      <GlassMenuItem onClick={() => void runChatAction(chat.id, 'tags')}>Tags…</GlassMenuItem>
                      <GlassMenuItem onClick={() => void runChatAction(chat.id, 'unread')}>Mark unread</GlassMenuItem>
                      {(onChatAction) && <GlassMenuItem onClick={() => void runChatAction(chat.id, 'clone')}>Clone chat</GlassMenuItem>}
                      <GlassMenuItem onClick={() => void runChatAction(chat.id, 'archive')}>{chat.archivedAt ? 'Restore chat' : 'Archive chat'}</GlassMenuItem>
                      <GlassMenuSeparator/>
                      <GlassMenuItem onClick={() => void moveChat(chat.id, null)}>Ungrouped</GlassMenuItem>
                      {groups.map((item) => <GlassMenuItem key={item.id} onClick={() => void moveChat(chat.id, item.id)}>{item.name}</GlassMenuItem>)}
                      <GlassMenuItem onClick={() => void createGroup()}>New group…</GlassMenuItem>
                      <GlassMenuSeparator/>
                      <GlassMenuItem onClick={() => void runChatAction(chat.id, 'delete')}>Delete chat…</GlassMenuItem>
                    </GlassMenuContent>
                  </GlassMenu>
                </div>
              )}
              {selecting && <ListBox.ItemIndicator />}
            </ListBox.Item>
          ))}
        </ListBox>
      ) : (
        <div className="directory-chats directory-empty" aria-label="Conversations">
          <HugeiconsIcon icon={AiChat02Icon} size={24}/>
          <p>{query ? 'No matching chats.' : group !== 'all' ? 'Move a chat into this group using its menu.' : 'Your conversations will appear here.'}</p>
          <Button variant="ghost" size="sm" onPress={onNew} isDisabled={sending}>Start a chat</Button>
        </div>
      )}
    </div>
  );
}
