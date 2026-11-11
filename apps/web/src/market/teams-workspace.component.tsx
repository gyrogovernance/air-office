import { useState } from 'react';
import { Avatar, Button, Form, Input, Label, Modal, TextArea, TextField } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import type { MethodDefinition, ModelPreset } from '@office/methods/domain';
import { MarbleBeamAvatar } from '../app/marble-beam-avatar.component';
import { WorkspaceDestinationIcon } from '../app/workspace-destination-icon.component';
import { CollectionDashboard } from '../shared/collection-dashboard.component';
import { settingsSectionIcons } from '../settings/settings.policy';
import type { MethodsWorkspaceState } from './methods-workspace.hook';

function TeamAvatar({ name }: { name: string }) {
  return (
    <Avatar size="sm" aria-hidden="true">
      <Avatar.Fallback>
        <MarbleBeamAvatar name={name} size="100%" />
      </Avatar.Fallback>
    </Avatar>
  );
}

function modelLabel(model: string) {
  return model && model !== 'unassigned' ? model : 'Model not specified';
}

export function TeamsWorkspace({
  agents,
  sending,
  onChat,
  onManage,
  onSave,
}: {
  agents: MethodDefinition[];
  sending: boolean;
  onChat: (id: string) => void;
  onManage: () => void;
  onSave: MethodsWorkspaceState['save'];
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ModelPreset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const presets = agents.flatMap((agent) => (agent.kind === 'preset' ? [agent.value] : []));
  const visible = presets.filter((preset) => `${preset.name} ${preset.instructions}`.toLowerCase().includes(query.toLowerCase()));
  const preset = visible.find((agent) => agent.id === selectedId) ?? visible[0];

  async function save() {
    if (!editing) return;
    setBusy(true);
    const result = await onSave({ kind: 'preset', value: { ...editing, updatedAt: new Date().toISOString() } });
    setBusy(false);
    if (result) setEditing(null);
    else setError('The agent could not be saved. Your draft is still open.');
  }

  return (
    <>
      <CollectionDashboard
        title="Teams"
        hero={{
          icon: <WorkspaceDestinationIcon name="teams" size={56} />,
          subtitle: 'Your AI agents, ready to work with you.',
        }}
        heading={`${presets.length} AI ${presets.length === 1 ? 'agent' : 'agents'}`}
        actions={<Button onPress={onManage}>Manage agents</Button>}
        listLabel="Team agents"
        search={{ value: query, onChange: setQuery, placeholder: 'Find an agent…', label: 'Search agents' }}
        items={visible.map((agent) => ({ id: agent.id, title: agent.name, description: modelLabel(agent.model), icon: <TeamAvatar name={agent.name} /> }))}
        selectedId={preset?.id ?? null}
        onSelect={setSelectedId}
        preview={
          preset
            ? {
                title: preset.name,
                description: ['AI agent', preset.provider, modelLabel(preset.model)].filter(Boolean).join(' · '),
                configuration: {
                  title: 'Configuration',
                  facts: [
                    {
                      label: 'Knowledge',
                      value: `${preset.knowledgeCollectionIds.length} collections`,
                      icon: <HugeiconsIcon icon={settingsSectionIcons.knowledge} size={16} aria-hidden="true" />,
                    },
                    {
                      label: 'Skills',
                      value: `${preset.skillIds.length} attached`,
                      icon: <HugeiconsIcon icon={settingsSectionIcons.skill} size={16} aria-hidden="true" />,
                    },
                    {
                      label: 'Tools',
                      value: `${preset.toolIds.length} attached`,
                      icon: <HugeiconsIcon icon={settingsSectionIcons.tools} size={16} aria-hidden="true" />,
                    },
                    {
                      label: 'Model settings',
                      value: preset.settings.temperature !== undefined ? `Temperature ${preset.settings.temperature}` : 'Provider defaults',
                      icon: <HugeiconsIcon icon={settingsSectionIcons.advanced} size={16} aria-hidden="true" />,
                    },
                  ],
                },
                content: (
                  <>
                    <h3 className="collection-dashboard__section-heading text-sm font-medium">
                      Instructions
                    </h3>
                    <p className="collection-dashboard__prose text-sm leading-relaxed">
                      {preset.instructions || 'This agent uses the model’s default behavior. Add instructions to give it a role.'}
                    </p>
                  </>
                ),
                actions: (
                  <>
                    <Button isDisabled={sending} onPress={() => onChat(preset.id)}>
                      Start chat
                    </Button>
                    <Button
                      variant="secondary"
                      onPress={() => {
                        setError('');
                        setEditing(preset);
                      }}
                    >
                      Edit agent
                    </Button>
                  </>
                ),
              }
            : null
        }
        empty={
          query
            ? {
                title: 'No matching agents',
                description: 'Try a different name or instruction.',
                action: (
                  <Button variant="secondary" onPress={() => setQuery('')}>
                    Clear search
                  </Button>
                ),
              }
            : {
                title: 'Your team starts here',
                description: 'Create agents with their own instructions, models, tools and knowledge.',
                action: <Button onPress={onManage}>Create an agent</Button>,
              }
        }
      />
      {editing && (
        <Modal.Backdrop
          isOpen
          isDismissable={!busy}
          isKeyboardDismissDisabled={busy}
          onOpenChange={(open) => {
            if (!open && !busy) setEditing(null);
          }}
        >
          <Modal.Container>
            <Modal.Dialog aria-labelledby="team-edit-title">
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <Modal.Header>
                  <Modal.Heading id="team-edit-title">Edit agent</Modal.Heading>
                </Modal.Header>
                <Modal.Body>
                  <TextField isRequired isDisabled={busy} value={editing.name} onChange={(name) => setEditing({ ...editing, name })}>
                    <Label>Name</Label>
                    <Input maxLength={120} />
                  </TextField>
                  <TextField isDisabled={busy} value={editing.instructions} onChange={(instructions) => setEditing({ ...editing, instructions })}>
                    <Label>Instructions</Label>
                    <TextArea rows={6} />
                  </TextField>
                  <p className="text-sm text-muted">Use Manage agents to configure the model, tools and knowledge.</p>
                  {error && (
                    <p role="alert" className="text-danger">
                      {error}
                    </p>
                  )}
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="secondary" isDisabled={busy} onPress={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" isDisabled={busy}>
                    {busy ? 'Saving…' : 'Save agent'}
                  </Button>
                </Modal.Footer>
              </Form>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      )}
    </>
  );
}
