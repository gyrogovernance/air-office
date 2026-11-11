/**
 * AIR controls in the Elements Thread composer action row: stage placement,
 * knowledge attach, Ask-first permission, model, agent, and reasoning.
 * Draft restore and slash / @ triggers live here so the kit composer stays intact.
 */
import { Button, Dropdown, type Selection } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Settings01Icon, ShieldCheckIcon, ShieldEnergyIcon } from '@hugeicons/core-free-icons';
import { ComposerPrimitive, unstable_useSlashCommandAdapter, useAui, useAuiState } from '@assistant-ui/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ComposerExtraProps } from '../components/assistant-ui/elements/thread.aui';
/* Model context registration follows /elements/composer-model-picker. */
import { SelectField } from '../shared/select-field.component';
import { ChromeTooltip } from '../shared/chrome-tooltip.component';
import { createServiceClient } from '../shared/service-client.hook';
import { MarbleBeamAvatar } from '../app/marble-beam-avatar.component';
import { IconChevronLeft, IconChevronRight, IconPlus, IconSettings } from '../app/ui-icons.component';
import { ComposerAttachDialog } from './composer-attach-dialog.component';
import { ComposerCaptureDialog } from './composer-capture-dialog.component';
import { ComposerContextChips } from './composer-knowledge-picker.component';
import { attachContext, type ComposerContextSelection } from './composer-context.policy';
import { MAX_CHAT_ATTACHMENTS, readChatDraft, writeChatDraft } from './composer.policy';
import { composerMissingModelLabel, composerModelTriggerLabel, modelIdFromKey, type ModelLabelIcon } from '../models/local-ai/model-label.policy';
import type { KnowledgeWorkspaceState } from '../knowledge/knowledge-workspace.hook';

const MANAGE_MODELS_VALUE = '__manage-models__';
const MANAGE_AGENTS_VALUE = '__manage-agents__';

/** Survives ComposerExtra remounts so a parent re-render cannot re-apply a stale draft over live typing. */
let restoredDraftConversation: string | null | undefined = undefined;

export type ChatComposerExtraProps = {
  conversationId: string | null;
  inStage?: boolean;
  onOpenStage?: () => void;
  onOpenRail?: () => void;
  commandPermission?: 'ask' | 'allow-all';
  onCommandPermission?: (value: 'ask' | 'allow-all') => void;
  models: { value: string; label: string; icon?: ModelLabelIcon }[];
  selectedModel: string;
  onSelectModel: (value: string) => void;
  agents: { value: string; label: string }[];
  selectedAgent: string;
  onSelectAgent: (value: string) => void;
  onAgentSetup?: () => void;
  reasoningLevels?: { value: string; label: string }[];
  reasoningEffort?: string;
  onReasoningEffort?: (value: string) => void;
  onModelSetup?: () => void;
  imagesAccepted: boolean | null;
  slashCommandsEnabled?: boolean;
  slashCommands?: { id: string; label: string; description: string }[];
  onSlashCommand?: (id: string) => void;
  knowledge: KnowledgeWorkspaceState;
  contextSelection: ComposerContextSelection;
  onContextSelectionChange: (selection: ComposerContextSelection) => void;
};

/** Slash and @ popovers must wrap the Elements input; mount beside Thread. */
export function ChatComposerTriggers(props: Pick<ChatComposerExtraProps, 'slashCommandsEnabled' | 'slashCommands' | 'onSlashCommand' | 'knowledge' | 'contextSelection' | 'onContextSelectionChange'>): ReactNode {
  const slashCommands = props.slashCommands ?? [];
  const slash = unstable_useSlashCommandAdapter({
    removeOnExecute: true,
    commands: slashCommands.map((command) => ({
      id: command.id,
      label: command.label,
      description: command.description,
      execute: () => props.onSlashCommand?.(command.id),
    })),
  });
  const contentCommands = useMemo(() => {
    const commands: { id: string; label: string; description: string; execute: () => void }[] = [];
    for (const collection of props.knowledge.collections) {
      commands.push({
        id: `collection:${collection.id}`,
        label: collection.name,
        description: 'Collection',
        execute: () => props.onContextSelectionChange(attachContext(props.contextSelection, { kind: 'collection', id: collection.id, name: collection.name })),
      });
    }
    for (const document of props.knowledge.documents) {
      commands.push({
        id: `document:${document.id}`,
        label: document.name,
        description: document.kind || 'Document',
        execute: () => props.onContextSelectionChange(attachContext(props.contextSelection, { kind: 'document', id: document.id, name: document.name, collectionId: document.collectionId })),
      });
    }
    return commands;
  }, [props.knowledge.collections, props.knowledge.documents, props.contextSelection, props.onContextSelectionChange]);
  const mention = unstable_useSlashCommandAdapter({
    removeOnExecute: true,
    commands: contentCommands,
  });

  return <>
    {props.slashCommandsEnabled !== false && slashCommands.length > 0 && <ComposerPrimitive.TriggerPopover char="/" adapter={slash.adapter} className="compose-slash-popover" aria-label="Skills and prompts">
      <ComposerPrimitive.TriggerPopover.Action {...slash.action}/>
      <ComposerPrimitive.TriggerPopoverItems className="compose-slash-items">
        {(items) => items.map((item, index) => <ComposerPrimitive.TriggerPopoverItem key={item.id} item={item} index={index} className="compose-slash-item">
          <span className="compose-slash-label">{item.label ?? item.id}</span>
          {'description' in item && typeof item.description === 'string' && item.description ? <span className="compose-slash-description">{item.description}</span> : null}
        </ComposerPrimitive.TriggerPopoverItem>)}
      </ComposerPrimitive.TriggerPopoverItems>
    </ComposerPrimitive.TriggerPopover>}
    {contentCommands.length > 0 && <ComposerPrimitive.TriggerPopover char="@" adapter={mention.adapter} className="compose-slash-popover" aria-label="Knowledge">
      <ComposerPrimitive.TriggerPopover.Action {...mention.action}/>
      <ComposerPrimitive.TriggerPopoverItems className="compose-slash-items">
        {(items) => items.map((item, index) => <ComposerPrimitive.TriggerPopoverItem key={item.id} item={item} index={index} className="compose-slash-item">
          <span className="compose-slash-label">{item.label ?? item.id}</span>
          {'description' in item && typeof item.description === 'string' && item.description ? <span className="compose-slash-description">{item.description}</span> : null}
        </ComposerPrimitive.TriggerPopoverItem>)}
      </ComposerPrimitive.TriggerPopoverItems>
    </ComposerPrimitive.TriggerPopover>}
  </>;
}

export function ChatComposerExtra(props: ChatComposerExtraProps & ComposerExtraProps) {
  const aui = useAui();
  const text = useAuiState((state) => state.composer.text);
  const attachments = useAuiState((state) => state.composer.attachments);
  const restoredFor = useRef<string | null | undefined>(undefined);
  const skipPersist = useRef(false);
  const [attachError, setAttachError] = useState('');
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [captureDialogOpen, setCaptureDialogOpen] = useState(false);
  const composerClient = useMemo(() => createServiceClient(), []);
  const hasImageAttachment = attachments.some((attachment) => attachment.type === 'image' || attachment.contentType?.startsWith('image/'));
  const imageBlocked = hasImageAttachment && props.imagesAccepted === false;
  const selectedModelLabel = props.models.find((model) => model.value === props.selectedModel)?.label
    ?? (props.selectedModel ? modelIdFromKey(props.selectedModel) : 'This model');

  useEffect(() => {
    if (restoredFor.current === props.conversationId || restoredDraftConversation === props.conversationId) {
      restoredFor.current = props.conversationId;
      return;
    }
    restoredFor.current = props.conversationId;
    restoredDraftConversation = props.conversationId;
    setAttachError('');
    skipPersist.current = true;
    void aui.composer.clearAttachments();
    aui.composer.setText(readChatDraft(window.localStorage, props.conversationId));
  }, [aui, props.conversationId]);

  useEffect(() => {
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    writeChatDraft(window.localStorage, props.conversationId, text);
  }, [props.conversationId, text]);

  /** Publish the workspace model into assistant-ui model context for the next turn. */
  useEffect(() => {
    if (!props.selectedModel) return;
    const label = props.models.find((model) => model.value === props.selectedModel)?.label
      ?? modelIdFromKey(props.selectedModel);
    return aui.modelContext.register({
      getModelContext: () => ({ config: { modelName: label } }),
    });
  }, [aui, props.selectedModel, props.models]);

  const attachFiles = () => {
    if (imageBlocked) {
      setAttachError(`${selectedModelLabel} does not accept images. Switch to a model that supports image input, or remove the image files.`);
      return;
    }
    if (attachments.length >= MAX_CHAT_ATTACHMENTS) {
      setAttachError(`Attachments are limited to ${MAX_CHAT_ATTACHMENTS} files per message.`);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.hidden = true;
    document.body.appendChild(input);
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      const chosen = files.slice(0, MAX_CHAT_ATTACHMENTS - attachments.length);
      const skipped = files.length - chosen.length;
      for (const file of chosen) void aui.composer.addAttachment(file);
      setAttachError(skipped > 0 ? `${skipped} file${skipped === 1 ? '' : 's'} past the ${MAX_CHAT_ATTACHMENTS}-file limit ${skipped === 1 ? 'was' : 'were'} not added.` : '');
    };
    input.oncancel = () => input.remove();
    input.click();
  };

  const modelIcons = Object.fromEntries(props.models.filter((model) => model.icon).map((model) => [model.value, model.icon!]));
  const modelTriggerLabel = useMemo(() => {
    const model = props.models.find((item) => item.value === props.selectedModel);
    if (props.selectedModel && !model) return composerMissingModelLabel(props.selectedModel);
    return composerModelTriggerLabel(props.selectedModel, model?.label);
  }, [props.models, props.selectedModel]);
  const agentLeadings = useMemo(() => {
    const leadings: Record<string, ReactNode> = {
      '': <MarbleBeamAvatar name="No agent" size={16} />,
    };
    for (const agent of props.agents) {
      leadings[agent.value] = <MarbleBeamAvatar name={agent.label} size={16} />;
    }
    if (props.selectedAgent && !props.agents.some((agent) => agent.value === props.selectedAgent)) {
      leadings[props.selectedAgent] = <MarbleBeamAvatar name={props.selectedAgent} size={16} />;
    }
    return leadings;
  }, [props.agents, props.selectedAgent]);

  return <>
    <ComposerContextChips selection={props.contextSelection} onChange={props.onContextSelectionChange}/>
    {(attachError || imageBlocked || (hasImageAttachment && props.imagesAccepted === null)) && (
      <div className="compose-attach-notes" role="status">
        {imageBlocked && <p className="compose-attach-error" role="alert">{selectedModelLabel} does not accept image attachments.</p>}
        {hasImageAttachment && props.imagesAccepted === null && <p>Image support for {selectedModelLabel} is unknown.</p>}
        {attachError && <p className="compose-attach-error" role="alert">{attachError}</p>}
      </div>
    )}
    <div className="compose-extra-row">
      <div className="compose-extra-tools">
        <ChromeTooltip label="Attach"><Button className="compose-icon" variant="secondary" size="sm" isIconOnly aria-label="Attach to this message" aria-haspopup="dialog" onPress={() => setAttachDialogOpen(true)}><IconPlus/></Button></ChromeTooltip>
        {props.onCommandPermission && <Dropdown>
          <ChromeTooltip label="Permissions"><Button className="compose-icon compose-permission" data-permission={props.commandPermission} variant="secondary" size="sm" isIconOnly aria-label="Command permissions" aria-haspopup="menu"><HugeiconsIcon icon={props.commandPermission === 'allow-all' ? ShieldEnergyIcon : ShieldCheckIcon} size={16}/></Button></ChromeTooltip>
          <Dropdown.Popover className="command-permission-popover" placement={props.inStage ? 'top end' : 'bottom end'}>
            <Dropdown.Menu
              aria-label="Command permissions"
              className="command-permission-menu"
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={new Set([props.commandPermission === 'allow-all' ? 'allow-all' : 'ask'])}
              onSelectionChange={(keys: Selection) => {
                if (keys === 'all') return;
                const next = [...keys][0];
                if (next === 'ask' || next === 'allow-all') props.onCommandPermission?.(next);
              }}
            >
              <Dropdown.Item id="ask" textValue="Ask first" className="command-permission-option">
                <span className="command-permission-option-label">Ask first</span>
                <span className="command-permission-option-hint">Show each command and changing tool before it runs</span>
              </Dropdown.Item>
              <Dropdown.Item id="allow-all" textValue="Allow All" className="command-permission-option">
                <span className="command-permission-option-label">Allow All</span>
                <span className="command-permission-option-hint">Run without asking for approval</span>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>}
        {props.reasoningLevels && props.reasoningLevels.length > 0 && props.onReasoningEffort && <Dropdown>
          <ChromeTooltip label="Reasoning"><Button className="compose-icon" variant="secondary" size="sm" isIconOnly aria-label="Reasoning level" aria-haspopup="menu"><IconSettings /></Button></ChromeTooltip>
          <Dropdown.Popover className="compose-reasoning-popover" placement={props.inStage ? 'top end' : 'bottom end'}>
            <Dropdown.Menu
              aria-label="Reasoning level"
              className="compose-reasoning-menu"
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={new Set([props.reasoningEffort ?? props.reasoningLevels[0]!.value])}
              onSelectionChange={(keys: Selection) => {
                if (keys === 'all') return;
                const next = [...keys][0];
                if (typeof next === 'string') props.onReasoningEffort?.(next);
              }}
            >
              {props.reasoningLevels.map((level) => (
                <Dropdown.Item key={level.value} id={level.value} textValue={level.label} className="compose-reasoning-menu-item">
                  {level.label}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>}
      </div>
      <div className="compose-extra-models">
        <label className="compose-model compose-model--extra compose-model--agent"><span className="sr-only">Workspace agent</span><SelectField placement={props.inStage ? "top" : "bottom"} className="app-select" aria-label="Workspace agent" value={props.selectedAgent} placeholder="No agent" leadings={agentLeadings} triggerLabel="" footerAction={props.onAgentSetup ? { value: MANAGE_AGENTS_VALUE, label: 'Manage Agents', icon: Settings01Icon } : undefined} onValueChange={(selectedValue) => { if (selectedValue === MANAGE_AGENTS_VALUE) { props.onAgentSetup?.(); return; } props.onSelectAgent(selectedValue); }}>{props.selectedAgent && !props.agents.some((agent) => agent.value === props.selectedAgent) && <option value={props.selectedAgent}>{props.selectedAgent} (unavailable)</option>}<option value="">No agent</option>{props.agents.map((agent) => <option key={agent.value} value={agent.value}>{agent.label}</option>)}</SelectField></label>
        <label className="compose-model compose-model--extra compose-model--model"><span className="sr-only">Workspace model</span><SelectField placement={props.inStage ? "top" : "bottom"} className="app-select" aria-label="Workspace model" value={props.selectedModel} placeholder="Choose a model" listEmptyOption={false} searchable footerAction={props.onModelSetup ? { value: MANAGE_MODELS_VALUE, label: 'Manage Models', icon: Settings01Icon } : undefined} onValueChange={(selectedValue) => { if (selectedValue === MANAGE_MODELS_VALUE) { props.onModelSetup?.(); return; } props.onSelectModel(selectedValue); }} icons={modelIcons} triggerLabel={modelTriggerLabel}>{props.selectedModel && !props.models.some((model) => model.value === props.selectedModel) && <option value={props.selectedModel}>{composerMissingModelLabel(props.selectedModel)}</option>}{props.models.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}</SelectField></label>
      </div>
      <div className="compose-extra-end">
        {props.onOpenStage && <ChromeTooltip label="Stage"><Button className="compose-icon" variant="secondary" size="sm" isIconOnly aria-label="Open chat in stage" onPress={props.onOpenStage}><IconChevronLeft/></Button></ChromeTooltip>}
        {props.onOpenRail && <ChromeTooltip label="Panel"><Button className="compose-icon" variant="secondary" size="sm" isIconOnly aria-label="Open chat in assistant panel" onPress={props.onOpenRail}><IconChevronRight/></Button></ChromeTooltip>}
        {props.trailing}
      </div>
    </div>
    {attachDialogOpen && <ComposerAttachDialog knowledge={props.knowledge} selection={props.contextSelection} onChange={props.onContextSelectionChange} onUploadFiles={attachFiles} onCapture={() => setCaptureDialogOpen(true)} onClose={() => setAttachDialogOpen(false)}/>}
    {captureDialogOpen && <ComposerCaptureDialog client={composerClient} onCapture={(file) => {
      if (attachments.length >= MAX_CHAT_ATTACHMENTS) {
        setAttachError(`Attachments are limited to ${MAX_CHAT_ATTACHMENTS} files per message.`);
        return;
      }
      void aui.composer.addAttachment(file);
      setAttachError('');
    }} onClose={() => setCaptureDialogOpen(false)}/>}
  </>;
}
