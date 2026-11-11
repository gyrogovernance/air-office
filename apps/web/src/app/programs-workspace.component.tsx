import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Description, Form, Input, Label, ListBox, Modal, ScrollShadow, Separator, Surface, TextArea, TextField } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Folder01Icon, File01Icon, Briefcase01Icon, Add01Icon } from '@hugeicons/core-free-icons';
import type { WorkspaceNode } from '@office/workspace/domain';
import type { ConversationSummary } from '@office/chat/domain';
import { FolderPickerButton } from '../shared/folder-picker.component';
import { SelectField } from '../shared/select-field.component';
import { ProgramKnowledge } from './program-knowledge.component';
import { createServiceClient } from '../shared/service-client.hook';
import { DashboardCatalog, DashboardViews, WorkspaceDashboard } from '../shared/collection-dashboard.component';
import { WorkspaceDestinationIcon } from './workspace-destination-icon.component';

type ProgramSection = 'files' | 'instructions' | 'conversations' | 'indexing';

interface ProgramsWorkspaceProps {
  initialScopeId?: string;
  initialSection?: 'files' | 'instructions';
  visit?: number;
  onOpenIndexSettings?: () => void;
  onScopeChange?: (scopeId: string) => void;
  onOpenNote: (id: string) => void;
  onOpenChat: (id: string) => void;
  chats?: ConversationSummary[];
  onCreateNote: (parentId: string) => Promise<void>;
  onStartChat: (parentId: string) => void | Promise<void>;
  onOpenLibrary: (scopeId: string) => void;
  onChanged: () => void | Promise<void>;
}

export function ProgramsWorkspace(props: ProgramsWorkspaceProps) {
  const [client] = useState(createServiceClient);
  const [nodes, setNodes] = useState<WorkspaceNode[]>([]);
  const [programId, setProgramId] = useState<string | null>(props.initialScopeId ?? null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const initializedScope = useRef<string | undefined>(undefined);
  const [creating, setCreating] = useState<'program' | 'project' | null>(null);
  const [name, setName] = useState('');
  const [section, setSection] = useState<ProgramSection>(props.initialSection ?? 'files');
  useEffect(() => {
    initializedScope.current = undefined;
    setSection(props.initialSection ?? 'files');
  }, [props.visit, props.initialSection]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [instructionDrafts, setInstructionDrafts] = useState<Record<string, { name: string; instruction: string }>>({});
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const result = await client.json<{ nodes: WorkspaceNode[] }>('/api/v1/workspace/nodes');
    setNodes(result.nodes);
  }, [client]);
  useEffect(() => {
    void refresh()
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Programs could not be loaded.'))
      .finally(() => setLoading(false));
  }, [refresh]);
  const programs = nodes.filter((node) => node.kind === 'program');
  useEffect(() => {
    if (initializedScope.current !== props.initialScopeId && props.initialScopeId && nodes.length) {
      let initial = nodes.find((node) => node.id === props.initialScopeId);
      const seen = new Set<string>();
      while (initial && initial.kind !== 'program' && initial.kind !== 'project' && !seen.has(initial.id)) {
        seen.add(initial.id);
        const parentId = initial.parentId;
        initial = nodes.find((node) => node.id === parentId);
      }
      if (initial?.kind === 'project') {
        setProgramId(initial.parentId ?? null);
        setProjectId(initial.id);
      } else if (initial?.kind === 'program') {
        setProgramId(initial.id);
        setProjectId(null);
      }
      initializedScope.current = props.initialScopeId;
    }
  }, [nodes, props.initialScopeId, props.visit]);
  useEffect(() => {
    const changed = () => {
      void refresh().catch(() => setError('Programs could not be refreshed.'));
    };
    window.addEventListener('office-workspace-changed', changed);
    return () => window.removeEventListener('office-workspace-changed', changed);
  }, [refresh]);
  const program = programs.find((node) => node.id === programId) ?? programs[0];
  const projects = nodes.filter((node) => node.kind === 'project' && node.parentId === program?.id);
  const project = projects.find((node) => node.id === projectId);
  const scope = project ?? program;
  useEffect(() => {
    if (scope) props.onScopeChange?.(scope.id);
  }, [scope?.id, props.onScopeChange]);
  const children = nodes.filter((node) => node.parentId === scope?.id && node.kind !== 'project');
  const scopeChats = props.chats?.filter((item) => item.folderId === scope?.id && !item.archivedAt) ?? [];
  async function addFolder(path: string) {
    if (!scope) return;
    await run(async () => {
      await client.json(`/api/v1/workspace/scopes/${encodeURIComponent(scope.id)}/folders`, { method: 'POST', body: JSON.stringify({ path }) });
      const result = await client.json<{ imported: string[]; skipped: { name: string; reason: string }[] }>(
        `/api/v1/workspace/scopes/${encodeURIComponent(scope.id)}/knowledge`,
        { method: 'POST' },
      );
      setNotice(
        `Folder added. ${result.imported.length} sources refreshed.${result.skipped.length ? ` ${result.skipped.length} files were not added to search.` : ''}`,
      );
    });
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
      await props.onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The change could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!name.trim() || !creating || (creating === 'project' && !program)) return;
    const kind = creating;
    await run(async () => {
      const { node } = await client.json<{ node: WorkspaceNode }>('/api/v1/workspace/nodes', {
        method: 'POST',
        body: JSON.stringify({ id: crypto.randomUUID(), kind, name: name.trim(), ...(kind === 'project' ? { parentId: program?.id } : {}) }),
      });
      if (kind === 'program') {
        setProgramId(node.id);
        setProjectId(null);
      } else setProjectId(node.id);
      setCreating(null);
      setName('');
    });
  }
  const views: { id: ProgramSection; label: string }[] = [
    { id: 'files', label: 'Files' },
    { id: 'instructions', label: 'Instructions' },
    { id: 'conversations', label: 'Conversations' },
    { id: 'indexing', label: 'Indexing' },
  ];
  const scopeTitleId = `program-scope-${scope?.id ?? 'empty'}`;

  function scopeContent(view: ProgramSection) {
    if (!scope || !program) return null;
    switch (view) {
      case 'instructions':
        return (
          <>
            {project && program.instruction && (
              <Surface variant="secondary" className="rounded-2xl p-3">
                <p className="programs-copy">Includes instructions from {program.name}.</p>
              </Surface>
            )}
            <ScopeInstructions
              node={scope}
              busy={busy}
              draft={instructionDrafts[scope.id]}
              onChange={(values) => setInstructionDrafts((current) => ({ ...current, [scope.id]: values }))}
              onSave={(values) =>
                run(async () => {
                  await client.json(`/api/v1/workspace/nodes/${encodeURIComponent(scope.id)}`, { method: 'PATCH', body: JSON.stringify(values) });
                })
              }
            />
            {project && (
              <div className="programs-move">
                <Label>Program</Label>
                <SelectField
                  aria-label="Program"
                  value={program.id}
                  disabled={busy}
                  onValueChange={(parentId) => {
                    void run(async () => {
                      await client.json(`/api/v1/workspace/nodes/${encodeURIComponent(project.id)}`, { method: 'PATCH', body: JSON.stringify({ parentId }) });
                      setProgramId(parentId);
                    });
                  }}
                >
                  {programs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </SelectField>
              </div>
            )}
          </>
        );
      case 'files':
        return (
          <section className="programs-material" aria-label="Files and notes">
            <header className="programs-section-heading">
              <h3 className="text-sm font-medium">Files and notes</h3>
              <div className="programs-actions">
                <Button variant="secondary" size="sm" isDisabled={busy} onPress={() => void run(() => props.onCreateNote(scope.id))}>
                  New note
                </Button>
                <FolderPickerButton
                  label="Add folder"
                  title={`Add folder to ${scope.name}`}
                  client={client}
                  disabled={busy}
                  onSelect={(path) => void addFolder(path)}
                />
              </div>
            </header>
            <ListBox
              aria-label="Scope files and notes"
              selectionMode="none"
              items={children}
              onAction={(key) => {
                const node = children.find((item) => item.id === key);
                if (node) {
                  if (node.kind === 'note') props.onOpenNote(node.targetId);
                  else props.onOpenLibrary(scope.id);
                }
              }}
              renderEmptyState={() => <Description>Add reference files or start a note here.</Description>}
            >
              {(node) => (
                <ListBox.Item id={node.id} textValue={node.name}>
                  <HugeiconsIcon icon={node.kind === 'note' ? File01Icon : Folder01Icon} size={20} aria-hidden="true" />
                  <div className="collection-dashboard__item-copy">
                    <Label>{node.name}</Label>
                    <Description>{node.kind === 'mount' ? 'Linked folder' : node.kind === 'note' ? 'Office note' : 'Folder'}</Description>
                  </div>
                  <ListBox.ItemIndicator>{() => null}</ListBox.ItemIndicator>
                </ListBox.Item>
              )}
            </ListBox>
          </section>
        );
      case 'conversations':
        return (
          <section className="programs-material" aria-label="Conversations">
            <h3 className="text-sm font-medium">Conversations</h3>
            <ListBox
              aria-label="Scope conversations"
              selectionMode="none"
              items={scopeChats}
              onAction={(key) => props.onOpenChat(String(key))}
              renderEmptyState={() => <Description>Start a chat to work with this scope’s instructions and sources.</Description>}
            >
              {(item) => (
                <ListBox.Item id={item.id} textValue={item.title}>
                  <Label>{item.title}</Label>
                </ListBox.Item>
              )}
            </ListBox>
          </section>
        );
      case 'indexing':
        return <ProgramKnowledge scopeId={scope.id} client={client} disabled={busy} />;
    }
  }

  function workspaceContent(view: ProgramSection) {
    return (
      <div className="collection-dashboard__columns programs-columns">
        <div className="programs-directory">
          <div className="programs-switcher">
            <SelectField
              aria-label="Program"
              value={program?.id ?? ''}
              disabled={!programs.length}
              onValueChange={(id) => {
                setProgramId(id);
                setProjectId(null);
              }}
            >
              {programs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </SelectField>
          </div>
          {program && (
            <section className="programs-catalog-group" aria-label={`Projects in ${program.name}`}>
              <h2 className="text-sm font-medium">Projects</h2>
              <DashboardCatalog
                listLabel="Projects"
                search={null}
                items={[
                  {
                    id: program.id,
                    title: 'Program overview',
                    description: 'Shared files and instructions',
                    icon: <HugeiconsIcon icon={Briefcase01Icon} size={22} aria-hidden="true" />,
                  },
                  ...projects.map((item) => ({
                    id: item.id,
                    title: item.name,
                    description: `${nodes.filter((child) => child.parentId === item.id).length} items`,
                    icon: <HugeiconsIcon icon={Folder01Icon} size={22} aria-hidden="true" />,
                  })),
                ]}
                selectedId={project?.id ?? program.id}
                onSelect={(id) => setProjectId(id === program.id ? null : id)}
                emptyDescription="Create a project for a specific piece of work."
              />
              {!projects.length && <p className="programs-catalog-hint text-sm text-muted">No projects yet. Create one for a specific piece of work.</p>}
            </section>
          )}
        </div>
        <Card className="collection-dashboard__preview programs-preview gap-3 p-3" role="region" aria-labelledby={scopeTitleId}>
          {scope && program ? (
            <>
              <Card variant="tertiary" className="settings-section-intro collection-preview-bubble p-3"><Card.Header className="collection-dashboard__profile">
                <div className="collection-dashboard__item-copy">
                  <Card.Title id={scopeTitleId} render={(cardProps) => <h2 {...cardProps} />} className="text-lg">
                    {project ? project.name : 'Shared workspace'}
                  </Card.Title>
                  <Card.Description>{project ? 'Project files, conversations and instructions' : 'Files and instructions available across this program'}</Card.Description>
                </div>
              </Card.Header></Card>
              <ScrollShadow className="collection-dashboard__scroll" tabIndex={0} role="region" aria-label={`${scope.name} ${view}`}>
                <Card variant="secondary" className="collection-preview-content" key={scope.id}><Card.Content className="programs-scope-content">
                  {scopeContent(view)}
                </Card.Content></Card>
              </ScrollShadow>
              <Separator />
              <Card.Footer className="collection-dashboard__actions">
                {view === 'files' && (
                  <Button variant="secondary" size="sm" onPress={() => props.onOpenLibrary(scope.id)}>
                    Browse files and chats
                  </Button>
                )}
                {view === 'indexing' && (
                  <Button variant="secondary" size="sm" onPress={props.onOpenIndexSettings}>
                    Indexing settings
                  </Button>
                )}
                <Button
                  size="sm"
                  isDisabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await props.onStartChat(scope.id);
                    })
                  }
                >
                  Start chat
                </Button>
              </Card.Footer>
            </>
          ) : (
            <Card.Header>
              <Card.Title id={scopeTitleId} render={(cardProps) => <h2 {...cardProps} />}>
                {loading ? 'Loading programs…' : 'Give your work a home'}
              </Card.Title>
              <Card.Description>Create a program for an area of your work, then add projects inside it.</Card.Description>
            </Card.Header>
          )}
        </Card>
      </div>
    );
  }

  return (
    <WorkspaceDashboard
      title="Programs"
      hero={{
        icon: <WorkspaceDestinationIcon name="programs" size={56} />,
        subtitle: 'Give your projects, sources and conversations a shared home.',
      }}
    >
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <DashboardViews
        label="Program sections"
        selectedKey={section}
        onSelect={setSection}
        views={views.map((view) => ({
          ...view,
          actions: (
            <>
              <Button
                variant="secondary"
                size="sm"
                isDisabled={busy || loading}
                onPress={() => {
                  setCreating('program');
                  setName('');
                }}
              >
                <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden="true" />
                New program
              </Button>
              {program && (
                <Button
                  size="sm"
                  isDisabled={busy}
                  onPress={() => {
                    setCreating('project');
                    setName('');
                  }}
                >
                  <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden="true" />
                  New project
                </Button>
              )}
            </>
          ),
          content: workspaceContent(view.id),
        }))}
      />
      {creating && (
        <Modal.Backdrop
          isOpen
          isDismissable={!busy}
          isKeyboardDismissDisabled={busy}
          onOpenChange={(open) => {
            if (!open && !busy) setCreating(null);
          }}
        >
          <Modal.Container>
            <Modal.Dialog aria-labelledby="program-create-title">
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void create();
                }}
              >
                <Modal.Header>
                  <Modal.Heading id="program-create-title">{creating === 'program' ? 'New program' : `New project in ${program?.name ?? ''}`}</Modal.Heading>
                </Modal.Header>
                <Modal.Body>
                  <TextField isRequired isDisabled={busy} value={name} onChange={setName}>
                    <Label>{creating === 'program' ? 'Program name' : 'Project name'}</Label>
                    <Input autoFocus maxLength={200} placeholder={creating === 'program' ? 'For example, Product development' : 'What are you working on?'} />
                  </TextField>
                  {error && (
                    <p role="alert" className="text-danger">
                      {error}
                    </p>
                  )}
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="secondary" isDisabled={busy} onPress={() => setCreating(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" isDisabled={busy || !name.trim()}>
                    Create {creating}
                  </Button>
                </Modal.Footer>
              </Form>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      )}
    </WorkspaceDashboard>
  );
}

function ScopeInstructions({
  node,
  busy,
  draft,
  onChange,
  onSave,
}: {
  node: WorkspaceNode;
  busy: boolean;
  draft?: { name: string; instruction: string };
  onChange: (values: { name: string; instruction: string }) => void;
  onSave: (values: { name: string; instruction: string }) => Promise<void>;
}) {
  const { name, instruction } = draft ?? node;
  return (
    <Form
      className="programs-instructions"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({ name, instruction });
      }}
    >
      <TextField isRequired isDisabled={busy} value={name} onChange={(value) => onChange({ name: value, instruction })}>
        <Label>Name</Label>
        <Input maxLength={200} />
      </TextField>
      <TextField isDisabled={busy} value={instruction} onChange={(value) => onChange({ name, instruction: value })}>
        <Label>Instructions</Label>
        <TextArea rows={6} placeholder="How should the assistant help with this work?" />
      </TextField>
      <p className="programs-copy text-sm text-muted">
        {node.kind === 'program' ? 'Shared with projects and chats in this program.' : 'Used with the program instructions in this project’s chats.'}
      </p>
      <div className="programs-actions">
        <Button type="submit" size="sm" isDisabled={busy || !name.trim() || (name === node.name && instruction === node.instruction)}>
          Save instructions
        </Button>
      </div>
    </Form>
  );
}
